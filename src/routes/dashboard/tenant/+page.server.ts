import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { maintenancePhotoError, MAINTENANCE_PHOTO, daysBetween } from '$lib/files';
import { buildNoticePdf } from '$lib/server/pdf';
import { managementContact } from '$lib/server/messages';
import { getLeaseCharges, summarizeLedger } from '$lib/server/billing';
import type { Charge, DocRecord, Inspection, Lease, MaintenanceRequest, Message, MoveOutNotice, Payment, UnitSettings } from '$lib/types';

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['tenant']);
	const { pb } = event.locals;

	let lease: Lease | null = null;
	try {
		lease = (await pb
			.collection('leases')
			.getFirstListItem(`tenant = "${user.id}"`, { sort: '-created' })) as unknown as Lease;
	} catch {
		lease = null;
	}

	let charges: Charge[] = [];
	let payments: Payment[] = [];
	let inspections: Inspection[] = [];
	let documents: DocRecord[] = [];
	let moveOutNotices: MoveOutNotice[] = [];

	if (lease) {
		const [chargesResult, paymentsRes, inspectionsRes, documentsRes, noticesRes] = await Promise.all([
			// Shared loader — identical records/order to the management billing view
			// (PocketBase rules still limit tenants to published charges).
			getLeaseCharges(pb, lease.id),
			pb
				.collection('payments')
				.getFullList({ filter: `lease = "${lease.id}"`, sort: '-date' })
				.then((r) => r as unknown as Payment[])
				.catch(() => [] as Payment[]),
			pb
				.collection('inspections')
				.getFullList({ filter: `lease = "${lease.id}"`, sort: '-date' })
				.then((r) => r as unknown as Inspection[])
				.catch(() => [] as Inspection[]),
			pb
				.collection('documents')
				.getFullList({ filter: `lease = "${lease.id}"`, sort: '-created' })
				.then((r) => r as unknown as DocRecord[])
				.catch(() => [] as DocRecord[]),
			pb
				.collection('move_out_notices')
				.getFullList({ filter: `lease = "${lease.id}"`, sort: '-created' })
				.then((r) => r as unknown as MoveOutNotice[])
				.catch(() => [] as MoveOutNotice[])
		]);
		charges = chargesResult.charges;
		payments = paymentsRes;
		inspections = inspectionsRes;
		documents = documentsRes;
		moveOutNotices = noticesRes;
	}

	const [maintenance, messages, contact] = await Promise.all([
		pb
			.collection('maintenance_requests')
			.getFullList({ filter: `requester = "${user.id}"`, sort: '-created' })
			.then((r) => r as unknown as MaintenanceRequest[])
			.catch(() => [] as MaintenanceRequest[]),
		pb
			.collection('messages')
			.getFullList({
				filter: `sender = "${user.id}" || recipient = "${user.id}"`,
				sort: 'created',
				expand: 'sender'
			})
			.then((r) => r as unknown as Message[])
			.catch(() => [] as Message[]),
		managementContact(pb)
	]);

	// Unit settings (Zelle instructions shown to the tenant).
	let settings: UnitSettings | null = null;
	try {
		const list = await pb.collection('settings').getList(1, 1, { sort: 'created' });
		settings = list.items.length > 0 ? (list.items[0] as unknown as UnitSettings) : null;
	} catch {
		settings = null;
	}

	return {
		user,
		lease,
		charges,
		payments,
		inspections,
		documents,
		maintenance,
		messages,
		contact,
		settings,
		moveOutNotices,
		ledger: summarizeLedger(charges, payments)
	};
};

export const actions: Actions = {
	createMaintenance: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!title || !description) {
			return fail(400, { section: 'maintenance', message: 'Title and description are required.' });
		}
		// Optional photo attachments (empty file-input placeholders are dropped).
		const photos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
		const photoError = maintenancePhotoError(photos);
		if (photoError) return fail(400, { section: 'maintenance', message: photoError });
		const payload = new FormData();
		payload.append('requester', user.id);
		payload.append('title', title);
		payload.append('description', description);
		payload.append('status', 'open');
		for (const f of photos) payload.append('photos', f, f.name);
		await locals.pb.collection('maintenance_requests').create(payload);
		return { section: 'maintenance', message: 'Maintenance request submitted.' };
	},

	addMaintenancePhotos: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { section: 'maintenance', message: 'Missing request id.' });
		const photos = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
		if (photos.length === 0) {
			return fail(400, { section: 'maintenance', message: 'Choose at least one photo.' });
		}
		// The user-scoped client 404s here on someone else's request (viewRule).
		const existing = await locals.pb
			.collection('maintenance_requests')
			.getOne(id)
			.catch(() => null);
		if (!existing) return fail(404, { section: 'maintenance', message: 'Request not found.' });
		const current = Array.isArray(existing.photos) ? (existing.photos as string[]) : [];
		const photoError =
			maintenancePhotoError(photos) ||
			(current.length + photos.length > MAINTENANCE_PHOTO.maxCount
				? `This request already has ${current.length} photo${current.length === 1 ? '' : 's'} — up to ${MAINTENANCE_PHOTO.maxCount} total.`
				: '');
		if (photoError) return fail(400, { section: 'maintenance', message: photoError });
		// 'photos+' APPENDS — earlier photos stay attached. The updateRule allows the
		// owning tenant (status untouched) and staff.
		const payload = new FormData();
		for (const f of photos) payload.append('photos+', f, f.name);
		await locals.pb.collection('maintenance_requests').update(id, payload);
		return {
			section: 'maintenance',
			message: `Added ${photos.length} photo${photos.length === 1 ? '' : 's'}.`
		};
	},

	sendMessage: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		if (!body) return fail(400, { section: 'messages', message: 'Message cannot be empty.' });

		const contact = await managementContact(locals.pb);
		if (!contact) {
			return fail(400, {
				section: 'messages',
				message: 'No management account is set up yet. Please try again later.'
			});
		}
		await locals.pb.collection('messages').create({
			sender: user.id,
			recipient: contact.id,
			body,
			read: false
		});
		return { section: 'messages', message: 'Message sent.' };
	},

	updateContact: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		if (!name) return fail(400, { section: 'contact', message: 'Name is required.' });
		await locals.pb.collection('users').update(user.id, { name, phone });
		return { section: 'contact', message: 'Contact details saved.' };
	},

	// Cleaning-receipt upload — same documents pipeline as the applicant uploader,
	// kind fixed to 'receipt' so it lands in the move-out section.
	uploadReceipt: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) {
			return fail(400, { section: 'receipt', message: 'Choose a receipt file first.' });
		}
		const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
		for (const file of files) {
			if (!ALLOWED.includes(file.type)) {
				return fail(400, { section: 'receipt', message: `"${file.name}" is not allowed — only PDF, JPEG, or PNG files.` });
			}
			if (file.size > 10 * 1024 * 1024) {
				return fail(400, { section: 'receipt', message: `"${file.name}" exceeds the 10 MB limit.` });
			}
		}
		// Link the current lease when one exists (management billing views filter by lease).
		let leaseId = '';
		try {
			const l = await locals.pb
				.collection('leases')
				.getFirstListItem(`tenant = "${user.id}"`, { sort: '-created' });
			leaseId = l.id;
		} catch {
			// no lease — receipt still uploads without the link
		}
		for (const file of files) {
			const payload = new FormData();
			payload.append('owner', user.id);
			payload.append('title', files.length > 1 ? `Cleaning receipt — ${file.name}` : 'Cleaning receipt');
			payload.append('kind', 'receipt');
			payload.append('file', file);
			if (leaseId) payload.append('lease', leaseId);
			await locals.pb.collection('documents').create(payload);
		}
		return { section: 'receipt', message: files.length === 1 ? 'Receipt uploaded.' : `${files.length} receipts uploaded.` };
	},

	// "Give move-out notice": stores the notice with a server timestamp plus a
	// frozen PDF copy. The client_token makes repeat clicks idempotent, and a
	// correction creates a NEW record (supersedes) — the original is never edited.
	// Nothing here ends the lease, changes rent, or approves the requested date.
	submitMoveOutNotice: async ({ request, locals }) => {
		const user = locals.user!;
		if (user.role !== 'tenant') {
			return fail(403, { section: 'notice', message: 'Only the tenant can give move-out notice.' });
		}
		const form = await request.formData();
		const requestedDate = String(form.get('requested_date') ?? '');
		const forwarding = String(form.get('forwarding_address') ?? '').trim().slice(0, 300);
		const notes = String(form.get('notes') ?? '').trim().slice(0, 2000);
		const signer = String(form.get('signer_name') ?? '').trim().slice(0, 200);
		const confirmed = form.get('confirm') === 'on';
		const token = String(form.get('client_token') ?? '').trim().slice(0, 64);
		const supersedes = String(form.get('supersedes') ?? '');

		if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
			return fail(400, { section: 'notice', message: 'Choose your intended move-out date.' });
		}
		if (!signer) return fail(400, { section: 'notice', message: 'Type your full name to sign.' });
		if (!confirmed) {
			return fail(400, { section: 'notice', message: 'Please confirm the notice before submitting.' });
		}

		// The tenant's own lease (collection rules scope this to the tenant as well).
		let lease: Lease | null = null;
		try {
			lease = (await locals.pb
				.collection('leases')
				.getFirstListItem(`tenant = "${user.id}"`, {
					sort: '-created',
					expand: 'tenant'
				})) as unknown as Lease;
		} catch {
			lease = null;
		}
		if (!lease) return fail(400, { section: 'notice', message: 'No active lease on your account.' });

		// Idempotency: a repeated click resends the same client token — report the
		// existing notice instead of creating a duplicate.
		if (token) {
			const dupe = await locals.pb
				.collection('move_out_notices')
				.getFirstListItem(`client_token = "${token}"`)
				.catch(() => null);
			if (dupe) {
				return { section: 'notice', message: 'Move-out notice already submitted — see below.' };
			}
		}

		// Corrections supersede an existing notice owned by this tenant + lease.
		let supersedesId = '';
		if (supersedes) {
			const prior = await locals.pb
				.collection('move_out_notices')
				.getOne(supersedes)
				.catch(() => null);
			if (prior && prior.tenant === user.id && prior.lease === lease.id) supersedesId = prior.id;
		}

		// Snapshot names/address at submission time.
		let address = '';
		let unit = '';
		try {
			const list = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
			address = (list.items[0] as unknown as UnitSettings)?.address ?? '';
			unit = (list.items[0] as unknown as UnitSettings)?.unit_name ?? '';
		} catch {
			// blank fallbacks are fine — the notice still names the lease
		}
		const tenantNames = lease.expand?.tenant?.name || user.name || user.email;

		const submittedAt = new Date();
		const submittedDate = submittedAt.toISOString().slice(0, 10);
		const days = daysBetween(submittedDate, requestedDate);

		const pdf = buildNoticePdf('Move-out notice', [
			`Tenant(s): ${tenantNames}`,
			`Property: ${address}${unit ? `, Unit: ${unit}` : ''}`,
			'',
			`I intend to end my tenancy at the above unit on ${requestedDate}.`,
			`Forwarding address: ${forwarding || 'Not provided'}`,
			`Notes: ${notes || '—'}`,
			'',
			`Submitted in the app on ${submittedDate} at ${submittedAt.toISOString().slice(11, 16)} UTC (server timestamp).`,
			`Days between submission and requested move-out: ${days}.`,
			`Confirmed by (typed signature): ${signer}`,
			'',
			'This in-app notice informs the management team. It may not by itself satisfy',
			'California or San Diego legal notice or delivery requirements, and the chosen',
			'date does not override the fixed lease term or other notice requirements.'
		]);

		const payload = new FormData();
		payload.append('lease', lease.id);
		payload.append('tenant', user.id);
		payload.append('tenant_names', tenantNames);
		payload.append('property_address', address);
		payload.append('unit', unit);
		payload.append('requested_date', requestedDate);
		payload.append('forwarding_address', forwarding);
		payload.append('notes', notes);
		payload.append('signer_name', signer);
		payload.append('submitted_at', submittedAt.toISOString());
		payload.append('status', 'submitted');
		if (supersedesId) payload.append('supersedes', supersedesId);
		if (token) payload.append('client_token', token);
		payload.append(
			'notice_pdf',
			new File([pdf as unknown as BlobPart], 'move-out-notice.pdf', { type: 'application/pdf' })
		);
		try {
			await locals.pb.collection('move_out_notices').create(payload);
		} catch (e) {
			const message = (e as { message?: string } | null)?.message ?? 'unknown error';
			return fail(500, { section: 'notice', message: `Could not save the notice: ${message}` });
		}
		return {
			section: 'notice',
			message: 'Move-out notice submitted — it is now visible to the management team on their dashboard.'
		};
	}
};
