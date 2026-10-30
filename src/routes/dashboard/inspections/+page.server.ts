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
import { archiveRequiredReason, canDeleteInspection } from '$lib/inspection-cleanup';
import type { Inspection, Lease, UnitSettings } from '$lib/types';

function inspectionLabel(inspection: Pick<Inspection, 'tenant_names' | 'address' | 'unit'>): string {
	const tenant = inspection.tenant_names?.trim() || 'Vacant / no tenant';
	const unit = inspection.unit?.trim() || '—';
	return `${tenant} · ${inspection.address || 'Unknown property'} · Unit ${unit}`;
}

async function fetchInspectionOrFail(pb: App.Locals['pb'], id: string): Promise<Inspection> {
	try {
		return (await pb.collection('inspections').getOne(id)) as unknown as Inspection;
	} catch {
		throw new Error('Inspection not found.');
	}
}

async function clearInspectionReferences(pb: App.Locals['pb'], id: string): Promise<void> {
	const [docs, notes, notifications] = await Promise.all([
		pb.collection('documents').getFullList({ filter: `inspection = "${id}"` }).catch(() => []),
		pb.collection('inspection_private_notes').getFullList({ filter: `inspection = "${id}"` }).catch(() => []),
		pb.collection('inspection_notifications').getFullList({ filter: `inspection = "${id}"` }).catch(() => [])
	]);

	for (const doc of docs as Array<{ id: string }>) {
		await pb.collection('documents').delete(doc.id).catch(() => undefined);
	}
	for (const note of notes as Array<{ id: string }>) {
		await pb.collection('inspection_private_notes').delete(note.id).catch(() => undefined);
	}
	for (const item of notifications as Array<{ id: string }>) {
		await pb.collection('inspection_notifications').delete(item.id).catch(() => undefined);
	}
}

export const load: PageServerLoad = async (event) => {
	requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;
	const showArchived = event.url.searchParams.get('show_archived') === '1';
	const filter = showArchived ? '' : 'archived = false';

	const [inspections, leases] = await Promise.all([
		pb
			.collection('inspections')
			.getFullList({ sort: '-date', expand: 'lease,lease.tenant,created_by', filter })
			.then((r) => r as unknown as Inspection[])
			.catch(() => [] as Inspection[]),
		pb
			.collection('leases')
			.getFullList({ sort: '-created', expand: 'tenant' })
			.then((r) => r as unknown as Lease[])
			.catch(() => [] as Lease[])
	]);

	return { user: event.locals.user!, inspections, leases, showArchived };
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
			archived: false,
			created_by: user.id,
			linked_inspection: linkedInspection,
			checklist,
			proposed_deductions: [],
			manager_notes: ''
		});

		throw redirect(303, `/dashboard/inspections/${record.id}`);
	},
	archiveInspection: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'No inspection selected.' });

		try {
			const inspection = await fetchInspectionOrFail(locals.pb, id);
			if (inspection.archived) {
				return fail(400, { message: 'This inspection is already archived.' });
			}
			await locals.pb.collection('inspections').update(id, { archived: true });
			return { message: `Archived inspection: ${inspectionLabel(inspection)}.` };
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not archive inspection.' });
		}
	},
	restoreInspection: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'No inspection selected.' });

		try {
			const inspection = await fetchInspectionOrFail(locals.pb, id);
			if (!inspection.archived) {
				return fail(400, { message: 'This inspection is not archived.' });
			}
			await locals.pb.collection('inspections').update(id, { archived: false });
			return { message: `Restored inspection: ${inspectionLabel(inspection)}.` };
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not restore inspection.' });
		}
	},
	deleteInspection: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'No inspection selected.' });

		try {
			const inspection = await fetchInspectionOrFail(locals.pb, id);
			if (!canDeleteInspection(inspection)) {
				const reason = archiveRequiredReason(inspection) || 'This inspection cannot be deleted.';
				return fail(400, { message: reason });
			}
			await clearInspectionReferences(locals.pb, id);
			await locals.pb.collection('inspections').delete(id);
			return { message: `Deleted unsigned draft: ${inspectionLabel(inspection)}.` };
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not delete inspection.' });
		}
	},
	bulkDeleteInspections: async ({ request, locals }) => {
		const form = await request.formData();
		const ids = form.getAll('ids').map((v) => String(v)).filter(Boolean);
		if (ids.length === 0) return fail(400, { message: 'Select at least one eligible inspection to delete.' });

		const deleted: string[] = [];
		const failed: string[] = [];
		for (const id of ids) {
			const inspection = await fetchInspectionOrFail(locals.pb, id).catch(() => null);
			if (!inspection) {
				failed.push(`Missing record ${id}`);
				continue;
			}
			if (!canDeleteInspection(inspection)) {
				const reason = archiveRequiredReason(inspection) || 'Not eligible for deletion.';
				failed.push(`${inspectionLabel(inspection)} — ${reason}`);
				continue;
			}
			await clearInspectionReferences(locals.pb, id);
			await locals.pb.collection('inspections').delete(id).catch(() => undefined);
			deleted.push(inspectionLabel(inspection));
		}

		if (deleted.length && failed.length) {
			return {
				message: `Deleted ${deleted.length} inspection(s). ${failed.length} could not be deleted: ${failed.slice(0, 3).join('; ')}.`
			};
		}
		if (deleted.length) {
			return { message: `Deleted ${deleted.length} inspection(s).` };
		}
		return fail(400, { message: `No eligible inspections were deleted. ${failed.slice(0, 3).join('; ')}` });
	}
};
