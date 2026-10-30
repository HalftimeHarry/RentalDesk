import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { managementContact } from '$lib/server/messages';
import { getLeaseCharges, summarizeLedger } from '$lib/server/billing';
import type { Charge, DocRecord, Inspection, Lease, MaintenanceRequest, Message, Payment, UnitSettings } from '$lib/types';

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

	if (lease) {
		const [chargesResult, paymentsRes, inspectionsRes, documentsRes] = await Promise.all([
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
				.catch(() => [] as DocRecord[])
		]);
		charges = chargesResult.charges;
		payments = paymentsRes;
		inspections = inspectionsRes;
		documents = documentsRes;
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
		await locals.pb.collection('maintenance_requests').create({
			requester: user.id,
			title,
			description,
			status: 'open'
		});
		return { section: 'maintenance', message: 'Maintenance request submitted.' };
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
	}
};
