import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { leaseMeetsMinimum, planLeaseCharges, summarizeLedger, toISODate } from '$lib/server/billing';
import { getActiveLease } from '$lib/server/lease';
import { parseMoneyToCents } from '$lib/format';
import type {
	Application,
	Charge,
	DocRecord,
	Inspection,
	Lease,
	MaintenanceRequest,
	Message,
	MoveOutNotice,
	Payment,
	UnitSettings,
	User
} from '$lib/types';

const FALLBACK_SETTINGS: Omit<UnitSettings, 'id' | 'created' | 'updated'> = {
	unit_name: 'Rental Unit',
	description: '',
	address: '',
	monthly_rent_cents: 225000,
	deposit_cents: 50000,
	min_lease_months: 3,
	available_date: '',
	is_available: true,
	zelle_instructions: '',
	photos: []
};

async function getSettings(pb: App.Locals['pb']): Promise<UnitSettings | null> {
	try {
		const list = await pb.collection('settings').getList(1, 1, { sort: 'created' });
		return list.items.length > 0 ? (list.items[0] as unknown as UnitSettings) : null;
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	const settingsRecord = await getSettings(pb);
	const settings: UnitSettings = {
		id: settingsRecord?.id ?? '',
		created: settingsRecord?.created ?? '',
		updated: settingsRecord?.updated ?? '',
		...FALLBACK_SETTINGS,
		...(settingsRecord ?? {})
	};

	const applications = (await pb
		.collection('applications')
		.getFullList({ sort: '-created', expand: 'applicant' })
		.catch(() => [])) as unknown as Application[];

	// Shared active-lease lookup — identical to the billing page.
	const { lease: activeLease, error: leaseError } = await getActiveLease(pb);

	let charges: Charge[] = [];
	let payments: Payment[] = [];
	let inspections: Inspection[] = [];
	let leaseDocuments: DocRecord[] = [];
	let moveOutNotices: MoveOutNotice[] = [];
	if (activeLease) {
		[charges, payments, inspections, leaseDocuments, moveOutNotices] = await Promise.all([
			pb
				.collection('charges')
				.getFullList({ filter: `lease = "${activeLease.id}"`, sort: 'due_date,created' })
				.then((r) => r as unknown as Charge[])
				.catch(() => [] as Charge[]),
			pb
				.collection('payments')
				.getFullList({ filter: `lease = "${activeLease.id}"`, sort: '-date' })
				.then((r) => r as unknown as Payment[])
				.catch(() => [] as Payment[]),
			pb
				.collection('inspections')
				.getFullList({ filter: `lease = "${activeLease.id}"`, sort: 'date' })
				.then((r) => r as unknown as Inspection[])
				.catch(() => [] as Inspection[]),
			pb
				.collection('documents')
				.getFullList({ filter: `lease = "${activeLease.id}"`, sort: '-created' })
				.then((r) => r as unknown as DocRecord[])
				.catch(() => [] as DocRecord[]),
			pb
				.collection('move_out_notices')
				.getFullList({ filter: `lease = "${activeLease.id}"`, sort: '-created', expand: 'tenant' })
				.then((r) => r as unknown as MoveOutNotice[])
				.catch(() => [] as MoveOutNotice[])
		]);
	}

	const maintenance = (await pb
		.collection('maintenance_requests')
		.getFullList({ sort: '-created', expand: 'requester' })
		.catch(() => [])) as unknown as MaintenanceRequest[];

	const messages = (await pb
		.collection('messages')
		.getFullList({ sort: '-created', expand: 'sender,recipient' })
		.catch(() => [])) as unknown as Message[];

	// Non-staff users are the messaging counterparties; owner additionally manages roles.
	const allUsers = (await pb
		.collection('users')
		.getFullList({ sort: 'created' })
		.catch(() => [])) as unknown as User[];

	// Upcoming dates: lease end within 60 days + future inspections.
	const today = new Date();
	const in60 = new Date(today);
	in60.setDate(in60.getDate() + 60);
	const upcoming: { date: string; label: string }[] = [];
	if (activeLease) {
		const end = new Date(`${activeLease.end_date}T00:00:00`);
		if (end >= today && end <= in60) {
			upcoming.push({ date: activeLease.end_date, label: 'Lease ends' });
		}
	}
	for (const i of inspections) {
		const d = new Date(`${i.date}T00:00:00`);
		if (d >= today) upcoming.push({ date: i.date, label: `Inspection (${i.type.replace('_', '-')})` });
	}
	upcoming.sort((a, b) => a.date.localeCompare(b.date));

	// Balance figures count only published charges; drafts stay management-only.
	const publishedCharges = charges.filter((c) => c.status !== 'draft');
	const paidByCharge = new Map<string, number>();
	for (const p of payments) {
		if (p.charge) paidByCharge.set(p.charge, (paidByCharge.get(p.charge) ?? 0) + p.amount_cents);
	}
	const unpaidCharges = publishedCharges
		.map((c) => ({ ...c, paid_cents: paidByCharge.get(c.id) ?? 0 }))
		.filter((c) => c.paid_cents < c.amount_cents);

	return {
		user,
		settings,
		applications,
		activeLease,
		leaseError,
		charges,
		payments,
		inspections,
		leaseDocuments,
		maintenance,
		messages,
		allUsers,
		upcoming,
		unpaidCharges,
		moveOutNotices,
		ledger: summarizeLedger(publishedCharges, payments),
		today: toISODate(today)
	};
};

/** Guard: returns the staff user, or null when the requester is not staff. */
function staffUser(event: RequestEvent): User | null {
	const user = event.locals.user;
	return user && (user.role === 'owner' || user.role === 'admin') ? user : null;
}

const staffOnly = () => fail(403, { section: 'error', message: 'Management access required.' });

/** Extract an actionable message from a PocketBase ClientResponseError. */
function pbError(e: unknown): string {
	const err = e as { response?: { message?: string }; message?: string } | null;
	return err?.response?.message || err?.message || 'unknown error';
}

export const actions: Actions = {
	// Move-out notices: acknowledging receipt and recording the agreed termination
	// date are deliberately separate from the tenant's requested date — the notice
	// never ends the lease, stops rent, or approves the date by itself.
	acknowledgeNotice: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { section: 'notice', message: 'Missing notice id.' });
		try {
			await locals.pb.collection('move_out_notices').update(id, {
				status: 'acknowledged',
				acknowledged_at: new Date().toISOString(),
				acknowledged_by: locals.user!.id
			});
		} catch (e) {
			return fail(500, { section: 'notice', message: `Acknowledge failed: ${pbError(e)}` });
		}
		return { section: 'notice', message: 'Receipt acknowledged.' };
	},

	recordTerminationDate: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const date = String(form.get('agreed_termination_date') ?? '');
		if (!id) return fail(400, { section: 'notice', message: 'Missing notice id.' });
		if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			return fail(400, { section: 'notice', message: 'Enter a valid date.' });
		}
		try {
			await locals.pb.collection('move_out_notices').update(id, { agreed_termination_date: date });
		} catch (e) {
			return fail(500, { section: 'notice', message: `Save failed: ${pbError(e)}` });
		}
		return {
			section: 'notice',
			message: date ? 'Agreed termination date recorded.' : 'Agreed termination date cleared.'
		};
	},

	updateSettings: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();

		const monthly_rent_cents = parseMoneyToCents(form.get('monthly_rent'));
		const deposit_cents = parseMoneyToCents(form.get('deposit'));
		if (monthly_rent_cents === null || deposit_cents === null) {
			return fail(400, { section: 'settings', message: 'Rent and deposit must be valid amounts.' });
		}

		const data = {
			unit_name: String(form.get('unit_name') ?? '').trim() || 'Rental Unit',
			description: String(form.get('description') ?? '').trim(),
			address: String(form.get('address') ?? '').trim(),
			monthly_rent_cents,
			deposit_cents,
			min_lease_months: Math.max(1, Number(form.get('min_lease_months')) || 3),
			available_date: String(form.get('available_date') ?? ''),
			// Checkbox absent from form data means false — false is preserved.
			is_available: form.get('is_available') === 'on'
		};

		// Locate the canonical settings record. A read error here is a real
		// failure — never silently treat it as "no record" and create duplicates.
		let existingId: string | null = null;
		let existingPhotos: string[] = [];
		try {
			const list = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
			if (list.items.length > 0) {
				existingId = list.items[0].id;
				existingPhotos = (list.items[0] as unknown as UnitSettings).photos ?? [];
			}
		} catch (e) {
			return fail(500, {
				section: 'settings',
				message: `Could not read current settings from PocketBase: ${pbError(e)}`
			});
		}

		// New listing photos are APPENDED: existing stored filenames are re-sent
		// so PocketBase keeps them alongside the new uploads.
		const photos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);

		let savedId: string;
		try {
			if (photos.length > 0) {
				const fd = new FormData();
				for (const [k, v] of Object.entries(data)) fd.append(k, String(v));
				for (const name of existingPhotos) fd.append('photos', name);
				for (const p of photos) fd.append('photos', p);
				savedId = existingId
					? (await locals.pb.collection('settings').update(existingId, fd)).id
					: (await locals.pb.collection('settings').create(fd)).id;
			} else if (existingId) {
				savedId = (await locals.pb.collection('settings').update(existingId, data)).id;
			} else {
				savedId = (await locals.pb.collection('settings').create(data)).id;
			}
		} catch (e) {
			return fail(500, { section: 'settings', message: `Save failed: ${pbError(e)}` });
		}

		// Confirm the write actually persisted before reporting success.
		try {
			const fresh = await locals.pb.collection('settings').getOne(savedId);
			const confirmed =
				fresh.unit_name === data.unit_name &&
				fresh.monthly_rent_cents === data.monthly_rent_cents &&
				fresh.deposit_cents === data.deposit_cents &&
				fresh.min_lease_months === data.min_lease_months &&
				fresh.is_available === data.is_available;
			if (!confirmed) {
				return fail(500, {
					section: 'settings',
					message: 'Save could not be confirmed — PocketBase returned different values.'
				});
			}
		} catch (e) {
			return fail(500, {
				section: 'settings',
				message: `Save could not be confirmed: ${pbError(e)}`
			});
		}

		return { section: 'settings', message: 'Settings saved and confirmed.' };
	},

	deleteSettingPhoto: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const filename = String(form.get('filename') ?? '');
		if (!filename) return fail(400, { section: 'settings', message: 'Missing photo filename.' });
		try {
			const list = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
			if (list.items.length === 0) {
				return fail(404, { section: 'settings', message: 'No settings record found.' });
			}
			const rec = list.items[0] as unknown as UnitSettings;
			const keep = (rec.photos ?? []).filter((p) => p !== filename);
			if (keep.length === (rec.photos ?? []).length) {
				return fail(404, { section: 'settings', message: 'Photo not found on the settings record.' });
			}
			// Re-send the filenames to KEEP; PocketBase removes the rest.
			const fd = new FormData();
			for (const name of keep) fd.append('photos', name);
			await locals.pb.collection('settings').update(rec.id, fd);
		} catch (e) {
			return fail(500, { section: 'settings', message: `Could not remove photo: ${pbError(e)}` });
		}
		return { section: 'settings', message: 'Photo removed.' };
	},

	setApplicationStatus: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const status = String(form.get('status') ?? '');
		const review_notes = String(form.get('review_notes') ?? '').trim();
		if (!['under_review', 'approved', 'denied'].includes(status)) {
			return fail(400, { section: 'applications', message: 'Invalid status.' });
		}
		await locals.pb.collection('applications').update(id, { status, review_notes });
		return { section: 'applications', message: `Application ${status.replace('_', ' ')}.` };
	},

	createLease: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();

		const applicantId = String(form.get('applicant') ?? '');
		const start_date = String(form.get('start_date') ?? '');
		const end_date = String(form.get('end_date') ?? '');
		const monthly_rent_cents = parseMoneyToCents(form.get('monthly_rent'));
		const deposit_cents = parseMoneyToCents(form.get('deposit'));

		if (!applicantId || !start_date || !end_date) {
			return fail(400, { section: 'lease', message: 'Applicant and lease dates are required.' });
		}
		if (monthly_rent_cents === null || deposit_cents === null) {
			return fail(400, { section: 'lease', message: 'Rent and deposit must be valid amounts.' });
		}

		const settings = await getSettings(locals.pb);
		const minMonths = settings?.min_lease_months ?? 3;
		if (!leaseMeetsMinimum(start_date, end_date, minMonths)) {
			return fail(400, {
				section: 'lease',
				message: `Lease must be at least ${minMonths} months long.`
			});
		}

		// One unit — one active lease at a time.
		const existing = await locals.pb
			.collection('leases')
			.getList(1, 1, { filter: 'status = "active"' })
			.catch(() => null);
		if (existing && existing.totalItems > 0) {
			return fail(400, {
				section: 'lease',
				message: 'There is already an active lease. End it before creating a new one.'
			});
		}

		// The applicant must have an approved application.
		let application: Application | null = null;
		try {
			application = (await locals.pb
				.collection('applications')
				.getFirstListItem(`applicant = "${applicantId}"`, {
					sort: '-created'
				})) as unknown as Application;
		} catch {
			application = null;
		}
		if (!application || application.status !== 'approved') {
			return fail(400, {
				section: 'lease',
				message: 'Only applicants with an approved application can receive a lease.'
			});
		}

		const lease = await locals.pb.collection('leases').create({
			tenant: applicantId,
			start_date,
			end_date,
			monthly_rent_cents,
			deposit_cents,
			status: 'active'
		});

		// Calendar-month billing schedule with proration + separate deposit charge.
		const planned = planLeaseCharges({ start_date, end_date, monthly_rent_cents, deposit_cents });
		for (const c of planned) {
			await locals.pb.collection('charges').create({ ...c, lease: lease.id });
		}

		// Promote the account from Applicant to Tenant (never to a management role).
		await locals.pb.collection('users').update(applicantId, { role: 'tenant' });

		// The unit is no longer on the market.
		if (settings?.id) {
			await locals.pb.collection('settings').update(settings.id, { is_available: false });
		}

		return { section: 'lease', message: 'Lease created and charges generated.' };
	},

	endLease: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		await locals.pb.collection('leases').update(id, { status: 'ended' });
		const settings = await getSettings(locals.pb);
		if (settings?.id) {
			await locals.pb.collection('settings').update(settings.id, { is_available: true });
		}
		return { section: 'lease', message: 'Lease ended. The unit is listed as available again.' };
	},

	addCharge: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const lease = String(form.get('lease') ?? '');
		const type = String(form.get('type') ?? 'other');
		const description = String(form.get('description') ?? '').trim();
		const amount_cents = parseMoneyToCents(form.get('amount'));
		const due_date = String(form.get('due_date') ?? '');

		if (!lease || !description || amount_cents === null || amount_cents <= 0 || !due_date) {
			return fail(400, {
				section: 'charges',
				message: 'Description, amount, and due date are required.'
			});
		}
		if (!['rent', 'deposit', 'late_fee', 'other'].includes(type)) {
			return fail(400, { section: 'charges', message: 'Invalid charge type.' });
		}
		await locals.pb.collection('charges').create({
			lease,
			type,
			description,
			amount_cents,
			due_date,
			period: '',
			prorated: false,
			status: 'published'
		});
		return { section: 'charges', message: 'Charge added.' };
	},

	updateMaintenance: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const status = String(form.get('status') ?? '');
		if (!['open', 'in_progress', 'resolved'].includes(status)) {
			return fail(400, { section: 'maintenance', message: 'Invalid status.' });
		}
		await locals.pb.collection('maintenance_requests').update(id, { status });
		return { section: 'maintenance', message: 'Maintenance request updated.' };
	},

	scheduleInspection: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const lease = String(form.get('lease') ?? '');
		const date = String(form.get('date') ?? '');
		const type = String(form.get('type') ?? 'periodic');
		const notes = String(form.get('notes') ?? '').trim();
		if (!lease || !date) {
			return fail(400, { section: 'inspections', message: 'Lease and date are required.' });
		}
		await locals.pb.collection('inspections').create({ lease, date, type, notes });
		return { section: 'inspections', message: 'Inspection scheduled.' };
	},

	uploadLeaseDocument: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const lease = String(form.get('lease') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const kind = String(form.get('kind') ?? 'lease');
		const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
		if (!lease || !title || files.length === 0) {
			return fail(400, { section: 'documents', message: 'Lease, title, and a file are required.' });
		}
		const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
		for (const file of files) {
			if (!ALLOWED.includes(file.type)) {
				return fail(400, {
					section: 'documents',
					message: `"${file.name}" is not allowed — only PDF, JPEG, or PNG files.`
				});
			}
		}
		for (const file of files) {
			const payload = new FormData();
			payload.append('owner', locals.user!.id);
			payload.append('lease', lease);
			payload.append('title', files.length > 1 ? `${title} — ${file.name}` : title);
			payload.append('kind', kind);
			payload.append('file', file);
			await locals.pb.collection('documents').create(payload);
		}
		return { section: 'documents', message: `${files.length} document(s) uploaded.` };
	},

	assignRole: async (event) => {
		// Only the Owner may assign management roles.
		const user = event.locals.user;
		if (!user || user.role !== 'owner') {
			return fail(403, { section: 'team', message: 'Only the owner can assign roles.' });
		}
		const { request, locals } = event;
		const form = await request.formData();
		const userId = String(form.get('user_id') ?? '');
		const role = String(form.get('role') ?? '');
		if (!['owner', 'admin', 'applicant', 'tenant'].includes(role)) {
			return fail(400, { section: 'team', message: 'Invalid role.' });
		}
		if (userId === user.id) {
			return fail(400, { section: 'team', message: 'You cannot change your own role.' });
		}
		await locals.pb.collection('users').update(userId, { role });
		return { section: 'team', message: 'Role updated.' };
	},

	sendMessage: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const recipient = String(form.get('recipient') ?? '');
		const body = String(form.get('body') ?? '').trim();
		if (!recipient || !body) {
			return fail(400, { section: 'messages', message: 'Recipient and message are required.' });
		}
		await locals.pb.collection('messages').create({
			sender: locals.user!.id,
			recipient,
			body,
			read: false
		});
		return { section: 'messages', message: 'Message sent.' };
	}
};
