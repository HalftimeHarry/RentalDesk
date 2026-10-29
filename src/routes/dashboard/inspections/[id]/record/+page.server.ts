import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { otherItems, parseChecklist, parseDeductions } from '$lib/inspection';
import type { DocRecord, Inspection } from '$lib/types';

export const load: PageServerLoad = async (event) => {
	requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	let inspection: Inspection;
	try {
		inspection = (await pb
			.collection('inspections')
			.getOne(event.params.id, {
				expand: 'lease,lease.tenant,created_by'
			})) as unknown as Inspection;
	} catch {
		error(404, 'Inspection not found.');
	}

	// Linked move-in record for move-out comparisons (never modified here).
	let linkedMoveIn: Inspection | null = null;
	if (inspection.linked_inspection) {
		linkedMoveIn = (await pb
			.collection('inspections')
			.getOne(inspection.linked_inspection)
			.catch(() => null)) as unknown as Inspection | null;
	}

	const checklist = parseChecklist(inspection.checklist);
	const documents = (await pb
		.collection('documents')
		.getFullList({ filter: `inspection = "${inspection.id}"`, sort: 'created' })
		.catch(() => [])) as unknown as DocRecord[];

	return {
		user: event.locals.user!,
		inspection,
		checklist,
		linkedMoveIn,
		others: otherItems(checklist),
		flagged: checklist.filter((c) => c.flagged),
		deductions: parseDeductions(inspection.proposed_deductions),
		documents
	};
};
