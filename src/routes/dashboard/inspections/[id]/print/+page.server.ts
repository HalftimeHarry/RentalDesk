import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guard';
import { flaggedItems, otherItems, parseChecklist, parseDeductions } from '$lib/inspection';
import { PUBLIC_POCKETBASE_URL } from '$lib/files';
import type { DocRecord, Inspection, UnitSettings } from '$lib/types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const { pb } = event.locals;

	let inspection: Inspection;
	try {
		inspection = (await pb
			.collection('inspections')
			.getOne(event.params.id, { expand: 'lease,lease.tenant,created_by' })) as unknown as Inspection;
	} catch {
		error(404, 'Inspection not found.');
	}

	const isStaff = user.role === 'owner' || user.role === 'admin';
	const isTenant = inspection.expand?.lease?.tenant === user.id;
	if (!isStaff && !isTenant) {
		redirect(303, '/dashboard');
	}
	// Tenants must never receive private manager notes — not even in the
	// serialized page data. Staff read them from the staff-only collection (the
	// record field itself is retired and always blank).
	if (isStaff) {
		const note = await pb
			.collection('inspection_private_notes')
			.getFirstListItem(`inspection = "${inspection.id}"`)
			.catch(() => null);
		inspection.manager_notes = (note as { body?: string } | null)?.body ?? '';
	} else {
		inspection.manager_notes = '';
	}

	// Photo attachments: resolve records and mint a short-lived file token with
	// the current user's permissions so thumbnails render in the report.
	const docs = (await pb
		.collection('documents')
		.getFullList({ filter: `inspection = "${inspection.id}"` })
		.catch(() => [])) as unknown as DocRecord[];
	const fileToken = await pb.files.getToken().catch(() => '');
	const photoUrl = (doc: DocRecord, thumb?: string) =>
		`${PUBLIC_POCKETBASE_URL}/api/files/documents/${doc.id}/${doc.file}?token=${encodeURIComponent(fileToken)}${thumb ? `&thumb=${thumb}` : ''}`;

	// Fully-signed reports render the frozen snapshot so the PDF always matches
	// what was signed.
	const snapshot = inspection.signed_snapshot as Record<string, unknown> | null;
	const content = (snapshot ? { ...inspection, ...snapshot } : inspection) as Inspection;
	const checklist = parseChecklist(content.checklist);

	// Linked move-in record for move-out comparisons.
	let linkedDate = '';
	if (inspection.linked_inspection) {
		const linked = (await pb
			.collection('inspections')
			.getOne(inspection.linked_inspection)
			.catch(() => null)) as unknown as Inspection | null;
		linkedDate = linked?.date ?? '';
	}

	// Branding for the printed report: unit/business info plus the owner
	// account's display name (best-effort — tenants may not be able to list users).
	const settings = (await pb
		.collection('settings')
		.getList(1, 1, { sort: 'created' })
		.then((l) => l.items[0] ?? null)
		.catch(() => null)) as unknown as UnitSettings | null;
	const owner = (await pb
		.collection('users')
		.getFirstListItem('role = "owner"')
		.catch(() => null)) as { name?: string; email?: string } | null;

	return {
		user,
		inspection: content,
		checklist,
		isStaff,
		unitName: settings?.unit_name ?? '',
		businessAddress: settings?.address ?? '',
		ownerName: owner?.name || owner?.email || '',
		photoDocs: Object.fromEntries(docs.map((d) => [d.id, d])),
		photoUrl: Object.fromEntries(docs.map((d) => [d.id, photoUrl(d, '100x100')])),
		others: otherItems(checklist),
		flagged: flaggedItems(checklist),
		deductions: parseDeductions(content.proposed_deductions),
		linkedDate,
		sigLandlordUrl: inspection.sig_landlord
			? `${PUBLIC_POCKETBASE_URL}/api/files/inspections/${inspection.id}/${inspection.sig_landlord}?token=${encodeURIComponent(fileToken)}`
			: '',
		sigTenantUrl: inspection.sig_tenant
			? `${PUBLIC_POCKETBASE_URL}/api/files/inspections/${inspection.id}/${inspection.sig_tenant}?token=${encodeURIComponent(fileToken)}`
			: '',
		pdfMode: event.url.searchParams.get('pdf') === '1'
	};
};
