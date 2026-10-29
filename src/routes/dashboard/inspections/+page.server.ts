import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import {
	DEFAULT_PROPERTY_ADDRESS,
	DEFAULT_UNIT,
	emptyChecklist,
	emptyState,
	parseChecklist
} from '$lib/inspection';
import type { Inspection, Lease, UnitSettings } from '$lib/types';

export const load: PageServerLoad = async (event) => {
	requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	const [inspections, leases] = await Promise.all([
		pb
			.collection('inspections')
			.getFullList({ sort: '-date', expand: 'lease,lease.tenant,created_by' })
			.then((r) => r as unknown as Inspection[])
			.catch(() => [] as Inspection[]),
		pb
			.collection('leases')
			.getFullList({ sort: '-created', expand: 'tenant' })
			.then((r) => r as unknown as Lease[])
			.catch(() => [] as Lease[])
	]);

	return { user: event.locals.user!, inspections, leases };
};

export const actions: Actions = {
	createInspection: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const leaseId = String(form.get('lease') ?? '');
		const type = String(form.get('type') ?? '');
		const freeName = String(form.get('tenant_name') ?? '').trim();

		if (!['move_in', 'move_out', 'periodic'].includes(type)) {
			return fail(400, { message: 'Choose an inspection type.' });
		}

		// Lease is optional: vacant-unit inspections just need a contact name.
		let lease: Lease | null = null;
		if (leaseId && leaseId !== 'vacant') {
			try {
				lease = (await locals.pb
					.collection('leases')
					.getOne(leaseId, { expand: 'tenant' })) as unknown as Lease;
			} catch {
				return fail(404, { message: 'Lease not found.' });
			}
		}
		if (!lease && !freeName) {
			return fail(400, {
				message: 'Select a lease, or enter a name for a vacant-unit inspection.'
			});
		}

		let settingsAddress = '';
		try {
			const list = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
			settingsAddress = (list.items[0] as unknown as UnitSettings)?.address ?? '';
		} catch {
			// fall back to the default address
		}

		// Dates come from the lease — never hardcoded. Staff may correct them in the form.
		let checklist = emptyChecklist();
		let linkedInspection = '';
		if (lease && type === 'move_out') {
			// Snapshot the move-in observations for side-by-side reference; the
			// move-in record itself is left untouched and linked.
			try {
				const moveIn = (await locals.pb
					.collection('inspections')
					.getFirstListItem(`lease = "${lease.id}" && type = "move_in"`, {
						sort: '-created'
					})) as unknown as Inspection;
				linkedInspection = moveIn.id;
				checklist = parseChecklist(moveIn.checklist).map((c) => ({
					...c,
					flagged: false,
					moveIn: { ...c.moveIn, photos: [...c.moveIn.photos] },
					moveOut: emptyState()
				}));
			} catch {
				// no move-in inspection yet — blank both sides
			}
		}

		const record = await locals.pb.collection('inspections').create({
			lease: lease?.id ?? '',
			date: new Date().toISOString().slice(0, 10),
			type,
			notes: '',
			address: settingsAddress || DEFAULT_PROPERTY_ADDRESS,
			unit: DEFAULT_UNIT,
			tenant_names: lease
				? lease.expand?.tenant?.name || lease.expand?.tenant?.email || ''
				: freeName,
			occupancy: lease ? 'occupied' : 'vacant',
			move_in_date: lease?.start_date ?? '',
			move_out_date: lease && type === 'move_out' ? lease.end_date : '',
			stage: 'draft',
			created_by: user.id,
			linked_inspection: linkedInspection,
			checklist,
			proposed_deductions: [],
			manager_notes: ''
		});

		redirect(303, `/dashboard/inspections/${record.id}`);
	}
};
