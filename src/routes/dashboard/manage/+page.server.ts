import { fail, type Actions, type RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { leaseMeetsMinimum, planLeaseCharges, summarizeLedger, toISODate } from '$lib/server/billing';
import { getActiveLease, getPendingLease } from '$lib/server/lease';
import { parseMoneyToCents } from '$lib/format';
import { sendMail } from '$lib/server/mail';
import { inviteAdminEmail } from '$lib/server/email-templates';
import { appBaseUrl, AppUrlConfigError, isExplicitProduction } from '$lib/server/app-url';
import { PUBLIC_APP_URL } from '$app/env/public';
import type {
	Application,
	Charge,
	DocRecord,
	HelpVideo,
	Inspection,
	Invitation,
	Lease,
	MaintenanceRequest,
	Message,
	MoveOutNotice,
	Payment,
	PropertyAccess,
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
	screening_fee_cents: 3500,
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

	// A pending lease (created from an approved application, awaiting the signed
	// packet + explicit activation) is managed separately and never appears in
	// tenant or billing views.
	const { lease: pendingLease, error: pendingLeaseError } = await getPendingLease(pb);
	let pendingLeaseDocuments: DocRecord[] = [];
	let pendingApplication: Application | null = null;
	let proposedCharges: ReturnType<typeof planLeaseCharges> = [];
	if (pendingLease) {
		[pendingLeaseDocuments, pendingApplication] = await Promise.all([
			pb
				.collection('documents')
				.getFullList({ filter: `lease = "${pendingLease.id}"`, sort: '-created' })
				.then((r) => r as unknown as DocRecord[])
				.catch(() => [] as DocRecord[]),
			pb
				.collection('applications')
				.getFirstListItem(`applicant = "${pendingLease.tenant}"`, { sort: '-created' })
				.then((r) => r as unknown as Application)
				.catch(() => null)
		]);
		// Proposed move-in charges for the activation review — nothing is created
		// until activation. PocketBase returns datetimes; slice to the date part.
		proposedCharges = planLeaseCharges({
			start_date: pendingLease.start_date.slice(0, 10),
			end_date: pendingLease.end_date.slice(0, 10),
			monthly_rent_cents: pendingLease.monthly_rent_cents,
			deposit_cents: pendingLease.deposit_cents
		});
	}

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

	// Pending + past invitations (staff-only collection).
	const invitations = (await pb
		.collection('invitations')
		.getFullList({ sort: '-created' })
		.catch(() => [])) as unknown as Invitation[];

	// Non-staff users are the messaging counterparties; owner additionally manages roles.
	const allUsers = (await pb
		.collection('users')
		.getFullList({ sort: 'created' })
		.catch(() => [])) as unknown as User[];

	const propertyAccess = (await pb
		.collection('property_access')
		.getFullList({ sort: 'label' })
		.catch(() => [])) as unknown as PropertyAccess[];

	// Staff walkthrough videos: the management-dashboard overview for admins, plus
	// the tenant and billing walkthroughs, surfaced together at the top.
	const helpVideos = (await pb
		.collection('help_videos')
		.getFullList({
			filter: 'active = true && (placement = "manage_dashboard" || placement = "tenant_dashboard" || placement = "manage_billing")',
			sort: 'created'
		})
		.catch(() => [])) as unknown as HelpVideo[];

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
		pendingLease,
		pendingLeaseError,
		pendingLeaseDocuments,
		pendingApplication,
		proposedCharges,
		charges,
		payments,
		inspections,
		leaseDocuments,
		maintenance,
		messages,
		invitations,
		allUsers,
		propertyAccess,
		helpVideos,
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
		const screening_fee = parseMoneyToCents(form.get('screening_fee'));
		if (screening_fee === null && String(form.get('screening_fee') ?? '').trim() !== '') {
			return fail(400, { section: 'settings', message: 'Screening fee must be a valid amount.' });
		}

		// Locate the canonical settings record. A read error here is a real
		// failure — never silently treat it as "no record" and create duplicates.
		let existingId: string | null = null;
		let existingPhotos: string[] = [];
		let existingFee = 3500;
		try {
			const list = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
			if (list.items.length > 0) {
				existingId = list.items[0].id;
				existingPhotos = (list.items[0] as unknown as UnitSettings).photos ?? [];
				const storedFee = (list.items[0] as unknown as UnitSettings).screening_fee_cents ?? 0;
				existingFee = storedFee > 0 ? storedFee : 3500;
			}
		} catch (e) {
			return fail(500, {
				section: 'settings',
				message: `Could not read current settings from PocketBase: ${pbError(e)}`
			});
		}

		const data = {
			unit_name: String(form.get('unit_name') ?? '').trim() || 'Rental Unit',
			description: String(form.get('description') ?? '').trim(),
			address: String(form.get('address') ?? '').trim(),
			monthly_rent_cents,
			deposit_cents,
			min_lease_months: Math.max(1, Number(form.get('min_lease_months')) || 3),
			available_date: String(form.get('available_date') ?? ''),
			// Checkbox values are explicit strings; normalize both checked values and
			// browsers that submit the legacy 'on' value.
			is_available: form.get('is_available') === 'true' || form.get('is_available') === 'on',
			// Blank fee input keeps the stored value (and never wipes it accidentally).
			screening_fee_cents: screening_fee ?? existingFee
		};

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

	savePropertyAccess: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const label = String(form.get('label') ?? '').trim();
		const type = String(form.get('type') ?? 'gate');
		const property = String(form.get('property') ?? '').trim();
		const unit = String(form.get('unit') ?? '').trim();
		const code = String(form.get('code') ?? '').trim();
		const instructions = String(form.get('instructions') ?? '').trim();
		const active = form.get('active') === 'on';

		if (!label || !code) {
			return fail(400, { section: 'property_access', message: 'Label and code are required.' });
		}
		// Scope is required — a blank property/unit is never tenant-visible, so
		// reject it up front with a clear message instead of saving a dead entry.
		if (type === 'gate' && !property) {
			return fail(400, {
				section: 'property_access',
				message:
					'Gate entries must name their property (exactly the listing address) — a gate is "this property, all applicable units", never every property.'
			});
		}
		if (type === 'door_lockbox' && !unit) {
			return fail(400, {
				section: 'property_access',
				message:
					'Door lockboxes must name their unit (exactly the listing unit name) — a lockbox never applies across units.'
			});
		}

		const payload = {
			label,
			type,
			property,
			unit,
			code,
			instructions,
			active
		};

		try {
			if (id) {
				await locals.pb.collection('property_access').update(id, payload);
				return { section: 'property_access', message: 'Property access saved.' };
			}
			await locals.pb.collection('property_access').create(payload);
			return { section: 'property_access', message: 'Property access entry created.' };
		} catch (e) {
			return fail(500, { section: 'property_access', message: `Save failed: ${pbError(e)}` });
		}
	},

	deletePropertyAccess: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { section: 'property_access', message: 'Missing property access id.' });
		try {
			await locals.pb.collection('property_access').delete(id);
		} catch (e) {
			return fail(500, { section: 'property_access', message: `Delete failed: ${pbError(e)}` });
		}
		return { section: 'property_access', message: 'Property access deleted.' };
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

		// One unit — one open lease at a time (active OR pending).
		const existing = await locals.pb
			.collection('leases')
			.getList(1, 1, { filter: 'status = "active" || status = "pending"' })
			.catch(() => null);
		if (existing && existing.totalItems > 0) {
			return fail(400, {
				section: 'lease',
				message: 'There is already an active or pending lease. Activate, end, or resolve it first.'
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

		// PENDING lease only — no Tenant role, no charges, no delisting. Those all
		// happen at explicit activation, after the signed packet is uploaded.
		await locals.pb.collection('leases').create({
			tenant: applicantId,
			start_date,
			end_date,
			monthly_rent_cents,
			deposit_cents,
			status: 'pending'
		});

		return {
			section: 'lease',
			message: 'Pending lease created. Upload the signed DocuSign packet, then activate the tenancy.'
		};
	},

	// Explicit activation of a pending lease. Requires an approved application and
	// an uploaded signed lease. Every step is skipped when already applied, so a
	// retry (double-click, refresh resubmit) never duplicates charges or repeats
	// transitions.
	activateLease: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const leaseId = String(form.get('lease') ?? '');
		if (!leaseId) return fail(400, { section: 'pending-lease', message: 'Lease is required.' });

		let lease: Lease;
		try {
			lease = (await locals.pb
				.collection('leases')
				.getOne(leaseId, { expand: 'tenant' })) as unknown as Lease;
		} catch {
			return fail(404, { section: 'pending-lease', message: 'Lease not found.' });
		}

		if (lease.status === 'active') {
			return { section: 'pending-lease', message: 'This lease is already active — no changes made.' };
		}
		if (lease.status !== 'pending') {
			return fail(400, { section: 'pending-lease', message: 'Only a pending lease can be activated.' });
		}

		// Approved application required.
		let application: Application | null = null;
		try {
			application = (await locals.pb
				.collection('applications')
				.getFirstListItem(`applicant = "${lease.tenant}"`, { sort: '-created' })) as unknown as Application;
		} catch {
			application = null;
		}
		if (!application || application.status !== 'approved') {
			return fail(400, { section: 'pending-lease', message: 'Activation requires an approved application.' });
		}

		// Completed signed lease (DocuSign packet) required.
		const signed = await locals.pb
			.collection('documents')
			.getList(1, 1, { filter: `lease = "${lease.id}" && kind = "signed_lease"` })
			.catch(() => null);
		if (!signed || signed.totalItems === 0) {
			return fail(400, {
				section: 'pending-lease',
				message: 'Upload the completed signed lease PDF before activating.'
			});
		}

		// 1. Draft move-in charges (publishing stays a manual Billing step). Skipped
		//    when any charge already exists for this lease.
		const existingCharges = await locals.pb
			.collection('charges')
			.getList(1, 1, { filter: `lease = "${lease.id}"` })
			.catch(() => null);
		const chargesCreated = !existingCharges || existingCharges.totalItems === 0;
		if (chargesCreated) {
			const planned = planLeaseCharges({
				start_date: lease.start_date.slice(0, 10),
				end_date: lease.end_date.slice(0, 10),
				monthly_rent_cents: lease.monthly_rent_cents,
				deposit_cents: lease.deposit_cents
			});
			for (const c of planned) {
				await locals.pb.collection('charges').create({ ...c, lease: lease.id, status: 'draft' });
			}
		}

		// 2. Activate the lease.
		await locals.pb.collection('leases').update(lease.id, { status: 'active' });

		// 3. Grant Tenant access (only from Applicant — never a management role).
		if (lease.expand?.tenant?.role === 'applicant') {
			await locals.pb.collection('users').update(lease.tenant, { role: 'tenant' });
		}

		// 4. Delist the unit.
		const settings = await getSettings(locals.pb);
		if (settings?.id && settings.is_available) {
			await locals.pb.collection('settings').update(settings.id, { is_available: false });
		}

		return {
			section: 'pending-lease',
			message: chargesCreated
				? 'Tenancy activated. Draft move-in charges created — publish them from Billing when ready.'
				: 'Tenancy activated. Charges already existed — none were duplicated.'
		};
	},

	// Staff confirmation that the applicant-reported screening fee actually
	// arrived. An applicant-entered reference alone only means "payment reported".
	confirmScreeningFee: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { section: 'applications', message: 'Application is required.' });
		await locals.pb.collection('applications').update(id, { screening_fee_confirmed: true });
		return { section: 'applications', message: 'Screening fee marked as received.' };
	},

	// Invite a new Admin by email link. Both Owner and Admin may invite; the
	// invitation can only ever grant Admin (schema allows no other role) and the
	// role is applied server-side at acceptance. One pending invite per email —
	// re-inviting returns the existing link instead of duplicating records.
	inviteAdmin: async (event) => {
		if (!staffUser(event)) return staffOnly();
		const { request, locals } = event;
		const user = locals.user!;
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
			return fail(400, { section: 'team', message: 'A valid email address is required.' });
		}
		if (email === user.email) {
			return fail(400, { section: 'team', message: 'You are already on the team.' });
		}

		// Resolve the trusted link base FIRST — a missing/invalid PUBLIC_APP_URL
		// is a clear configuration error and no invitation is created or sent.
		let base: string;
		try {
			base = appBaseUrl(PUBLIC_APP_URL, { production: isExplicitProduction() });
		} catch (e) {
			if (e instanceof AppUrlConfigError) {
				return fail(500, {
					section: 'team',
					message:
						'Invitations are unavailable: PUBLIC_APP_URL is missing or invalid for this environment. Ask the owner to configure it. No invitation was created.'
				});
			}
			throw e;
		}

		const existing = await locals.pb
			.collection('invitations')
			.getFirstListItem(`email = "${email}" && status = "pending"`)
			.catch(() => null);
		let invite: Invitation | null = existing as unknown as Invitation | null;
		if (!invite) {
			invite = (await locals.pb.collection('invitations').create({
				email,
				role: 'admin', // hard-coded — invitations can never grant Owner
				token: crypto.randomUUID(),
				status: 'pending',
				invited_by: user.id,
				expires: new Date(Date.now() + 7 * 86400_000).toISOString()
			})) as unknown as Invitation;
		}
		const inviteUrl = `${base}/invite/${invite.token}`;

		// Email is disabled by default during tests; the guarded sendMail enforces
		// the recipient allowlist. The link is always shown to staff so local
		// testing works without any email leaving the machine.
		let emailNote = 'Email delivery is disabled — share the link below for local testing.';
		try {
			const t = inviteAdminEmail({
				inviterName: user.name || user.email,
				url: inviteUrl,
				expires: invite.expires,
				appUrl: base
			});
			const result = await sendMail({ to: email, subject: t.subject, html: t.html, text: t.text });
			if (result.sent) emailNote = 'Invitation email sent.';
		} catch {
			emailNote = 'Email blocked by the test allowlist — use the link below.';
		}

		return {
			section: 'team',
			message: `Invitation for ${email} ${existing ? '(existing pending invite reused)' : 'created'}. ${emailNote}`,
			inviteUrl
		};
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
