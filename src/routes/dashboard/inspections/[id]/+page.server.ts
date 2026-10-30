import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { parseChecklist, parseDeductions, signaturesCoverSnapshot, type ChecklistItem } from '$lib/inspection';
import { parseMoneyToCents } from '$lib/format';
import { buildInspectionPdf } from '$lib/server/pdf';
import { notifySignedInspection, recipientsPreview, retryFailedNotifications } from '$lib/server/inspection-notify';
import { appBaseUrl, isExplicitProduction } from '$lib/server/app-url';
import { createSuperuserClient } from '$lib/server/pb';
import { PUBLIC_APP_URL } from '$app/env/public';
import type { DocRecord, Inspection, InspectionNotification } from '$lib/types';

const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

function pbError(e: unknown): string {
	const err = e as { response?: { message?: string }; message?: string } | null;
	return err?.response?.message || err?.message || 'unknown error';
}

async function loadDocMap(pb: App.Locals['pb'], inspectionId: string): Promise<Record<string, DocRecord>> {
	const docs = (await pb
		.collection('documents')
		.getFullList({ filter: `inspection = "${inspectionId}"`, sort: 'created' })
		.catch(() => [])) as unknown as DocRecord[];
	return Object.fromEntries(docs.map((d) => [d.id, d]));
}

/** Private manager annotations live in the staff-only collection — the
 * inspection record itself is tenant-visible, so they can never live on it. */
async function loadPrivateNote(pb: App.Locals['pb'], inspectionId: string): Promise<string> {
	const note = await pb
		.collection('inspection_private_notes')
		.getFirstListItem(`inspection = "${inspectionId}"`)
		.catch(() => null);
	return (note as { body?: string } | null)?.body ?? '';
}

async function upsertPrivateNote(pb: App.Locals['pb'], inspectionId: string, body: string, userId: string): Promise<void> {
	const existing = await pb
		.collection('inspection_private_notes')
		.getFirstListItem(`inspection = "${inspectionId}"`)
		.catch(() => null);
	if (existing) {
		if ((existing as { body?: string }).body !== body) {
			await pb.collection('inspection_private_notes').update(existing.id, { body });
		}
		return;
	}
	if (!body) return; // no empty notes
	await pb.collection('inspection_private_notes').create({ inspection: inspectionId, body, created_by: userId });
}

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	let inspection: Inspection;
	try {
		inspection = (await pb
			.collection('inspections')
			.getOne(event.params.id, { expand: 'lease,lease.tenant,created_by' })) as unknown as Inspection;
	} catch {
		redirect(303, '/dashboard/inspections');
	}

	// Delivery rows shown to management WITHOUT email addresses (the staff-only
	// collection still stores them for retries).
	const notificationRows = (await pb
		.collection('inspection_notifications')
		.getFullList({ filter: `inspection = "${inspection.id}"`, sort: 'created', expand: 'recipient' })
		.then((r) => r as unknown as InspectionNotification[])
		.catch(() => [] as InspectionNotification[])).map((n) => ({
			id: n.id,
			role: n.role,
			status: n.status,
			attempts: n.attempts,
			sent_at: n.sent_at,
			name: n.expand?.recipient?.name ?? ''
		}));

	return {
		user,
		inspection,
		checklist: parseChecklist(inspection.checklist),
		deductions: parseDeductions(inspection.proposed_deductions),
		documents: await loadDocMap(pb, inspection.id),
		privateNote: await loadPrivateNote(pb, inspection.id),
		notifications: notificationRows,
		// Intended recipients by NAME only — emails are resolved privilegedly at
		// send time and never enter this loader.
		recipientsPreview: recipientsPreview({
			landlordName: inspection.expand?.created_by?.name ?? null,
			tenantName: inspection.expand?.lease?.expand?.tenant?.name ?? null,
			tenantNames: inspection.tenant_names
		})
	};
};

/** Canonical content key — detects real content changes (ignores stage). */
function contentKeyOf(i: Inspection, noteBody: string): string {
	return JSON.stringify({
		address: i.address,
		unit: i.unit,
		tenant_names: i.tenant_names,
		occupancy: i.occupancy || 'occupied',
		move_in_date: String(i.move_in_date ?? '').slice(0, 10),
		move_out_date: String(i.move_out_date ?? '').slice(0, 10),
		date: String(i.date ?? '').slice(0, 10),
		type: i.type,
		notes: i.notes,
		manager_notes: noteBody,
		checklist: parseChecklist(i.checklist),
		proposed_deductions: parseDeductions(i.proposed_deductions)
	});
}

/** Shared save path for Save draft / Save inspection. */
async function save(
	event: Parameters<Actions[string]>[0],
	forceDraft: boolean,
	options: { allowSigned?: boolean } = {}
) {
	const { request, locals } = event;
	const id = event.params.id!;
	const user = locals.user!;
	const form = await request.formData();

	let existing: Inspection;
	try {
		existing = (await locals.pb.collection('inspections').getOne(id)) as unknown as Inspection;
	} catch {
		return fail(404, { section: 'inspection', message: 'Inspection not found.' });
	}

	const hasSignature = !!(existing.sig_landlord || existing.sig_tenant);
	if (hasSignature && !options.allowSigned) {
		return fail(400, {
			section: 'inspection',
			message: 'This inspection already has a signature. Create a revised inspection to continue editing.'
		});
	}

	let checklist: ChecklistItem[];
	try {
		checklist = parseChecklist(JSON.parse(String(form.get('checklist') ?? '[]')));
	} catch {
		return fail(400, { section: 'inspection', message: 'Checklist data was invalid — nothing saved.' });
	}

	// Proposed deductions: documented separately from recorded damage, never
	// applied to charges automatically.
	const rawDeductions = JSON.parse(String(form.get('proposed_deductions') ?? '[]')) as unknown;
	const proposed_deductions = parseDeductions(
		Array.isArray(rawDeductions)
			? rawDeductions.map((d) => ({
					description: String((d as { description?: unknown })?.description ?? ''),
					amount_cents:
						parseMoneyToCents(String((d as { amount?: unknown })?.amount ?? '')) ?? 0
				}))
				.filter((d) => d.description.trim().length > 0)
			: []
	);

	const occupancy = String(form.get('occupancy') ?? '');
	// Private annotations go to the staff-only collection, never onto the record.
	const privateNoteBody = String(form.get('manager_notes') ?? '').trim();
	const data = {
		address: String(form.get('address') ?? '').trim(),
		unit: String(form.get('unit') ?? '').trim(),
		tenant_names: String(form.get('tenant_names') ?? '').trim(),
		occupancy: ['occupied', 'vacant'].includes(occupancy) ? occupancy : existing.occupancy || 'occupied',
		move_in_date: String(form.get('move_in_date') ?? ''),
		move_out_date: String(form.get('move_out_date') ?? ''),
		date: String(form.get('date') ?? ''),
		type: String(form.get('type') ?? 'move_in'),
		stage: forceDraft ? 'draft' : String(form.get('stage') ?? (existing.stage || 'draft')),
		notes: String(form.get('notes') ?? '').trim(),
		manager_notes: '', // hard rule: private notes never touch the tenant-visible record
		checklist,
		proposed_deductions
	};

	if (!data.address || !data.unit) {
		return fail(400, { section: 'inspection', message: 'Property address and unit are required.' });
	}

	// Signed records are protected: ordinary editing is blocked until a manager
	// explicitly creates a new unsigned revision.
	let targetId = id;
	if (existing.stage === 'completed') {
		return fail(400, {
			section: 'inspection',
			message: 'This inspection is finalized and can no longer be edited.'
		});
	}

	// Upload helper for item photos and receipts; both become protected
	// documents linked to the target record (and the lease when one exists).
	const uploadDoc = async (file: File, kind: string, title: string) => {
		if (!ALLOWED_FILE_TYPES.includes(file.type)) {
			throw new Error(`"${file.name}" is not allowed — only PDF, JPEG, or PNG files.`);
		}
		const payload = new FormData();
		payload.append('owner', user.id);
		payload.append('kind', kind);
		payload.append('inspection', targetId);
		if (existing.lease) payload.append('lease', existing.lease);
		payload.append('title', title);
		payload.append('file', file);
		return locals.pb.collection('documents').create(payload);
	};

	// New photo attachments arrive inside the same multipart form as
	// photo_<moveIn|moveOut>_<itemIndex>. Upload them first so their ids are
	// stored with the checklist.
	for (const [key, value] of form.entries()) {
		if (!key.startsWith('photo_') || !(value instanceof File) || value.size === 0) continue;
		const [, side, indexRaw] = key.split('_');
		const index = Number(indexRaw);
		const item = checklist[index];
		if (!item || (side !== 'moveIn' && side !== 'moveOut')) {
			return fail(400, { section: 'inspection', message: 'A photo was attached to an unknown item.' });
		}
		try {
			const doc = await uploadDoc(value, 'inspection', `${item.section} — ${item.item} — ${value.name}`);
			item[side].photos.push(doc.id);
		} catch (e) {
			return fail(500, {
				section: 'inspection',
				message: `Photo "${value.name}" could not be uploaded: ${pbError(e)}. Nothing was saved.`
			});
		}
	}

	// Repair receipts / estimates for flagged follow-ups.
	for (const value of form.getAll('receipts')) {
		if (!(value instanceof File) || value.size === 0) continue;
		try {
			await uploadDoc(value, 'receipt', `Receipt/estimate — ${value.name}`);
		} catch (e) {
			return fail(500, {
				section: 'inspection',
				message: `Receipt "${value.name}" could not be uploaded: ${pbError(e)}. Nothing was saved.`
			});
		}
	}

	try {
		// 'signed' is only ever granted by the signature flow, never by a form post.
		if (data.stage === 'signed' && existing.stage !== 'signed') {
			data.stage = 'in_progress';
		}
		await locals.pb.collection('inspections').update(targetId, data);
	} catch (e) {
		return fail(500, { section: 'inspection', message: `Save failed: ${pbError(e)}` });
	}

	// Confirm the write before reporting success.
	try {
		const fresh = (await locals.pb.collection('inspections').getOne(targetId)) as unknown as Inspection;
		if (fresh.address !== data.address || fresh.stage !== data.stage) {
			return fail(500, {
				section: 'inspection',
				message: 'Save could not be confirmed — PocketBase returned different values.'
			});
		}
	} catch (e) {
		return fail(500, { section: 'inspection', message: `Save could not be confirmed: ${pbError(e)}` });
	}

	// Private manager annotations persist to the staff-only collection (never the record).
	try {
		await upsertPrivateNote(locals.pb, targetId, privateNoteBody, user.id);
	} catch (e) {
		return fail(500, {
			section: 'inspection',
			message: `Inspection saved, but the private note could not be saved: ${pbError(e)}`
		});
	}

	return {
		section: 'inspection',
		message: forceDraft ? 'Draft saved.' : 'Inspection saved.'
	};
}

/** Shared signature capture for the landlord and tenant boxes. */
async function sign(event: Parameters<Actions[string]>[0], who: 'landlord' | 'tenant') {
	const { request, locals } = event;
	const id = event.params.id!;
	const user = locals.user!;
	const form = await request.formData();

	let existing: Inspection;
	try {
		existing = (await locals.pb.collection('inspections').getOne(id)) as unknown as Inspection;
	} catch {
		return fail(404, { section: 'signatures', message: 'Inspection not found.' });
	}

	if (existing.stage === 'signed' || existing.stage === 'completed') {
		return fail(400, {
			section: 'signatures',
			message: existing.stage === 'completed'
				? 'This inspection is already completed and read-only.'
				: 'This inspection is already fully signed. Create a revised inspection to edit the content.'
		});
	}

	const fileField = who === 'landlord' ? 'sig_landlord' : 'sig_tenant';
	const already = who === 'landlord' ? existing.sig_landlord : existing.sig_tenant;
	if (already) {
		return fail(400, {
			section: 'signatures',
			message: `The ${who} has already signed this inspection.`
		});
	}

	const printedName = String(form.get(`${who}_name`) ?? '').trim();
	const acknowledged = form.get(`${who}_ack`) === 'on';
	const sigFile = form.get(`${who}_file`);

	if (!printedName) {
		return fail(400, { section: 'signatures', message: 'Printed name is required.' });
	}
	if (!acknowledged) {
		return fail(400, {
			section: 'signatures',
			message: 'Please tick the acknowledgement box before signing.'
		});
	}
	if (!(sigFile instanceof File) || sigFile.size === 0 || sigFile.type !== 'image/png') {
		return fail(400, { section: 'signatures', message: 'Draw the signature in the box first.' });
	}

	// Accurate device context: signatures are captured in person on the signed-in
	// staff account's device — never implying the tenant authenticated themselves.
	const meta =
		who === 'landlord'
			? `Signed by the landlord/manager via staff account “${user.name || user.email}”.`
			: `Signed by the tenant in person on the manager's device (staff account “${user.name || user.email}”) — not through the tenant's own login.`;

	const fd = new FormData();
	fd.append(fileField, sigFile, `${who}-signature.png`);
	fd.append(`${fileField}_name`, printedName);
	fd.append(`${fileField}_at`, new Date().toISOString()); // server-side timestamp
	fd.append(`${fileField}_meta`, meta);
	try {
		await locals.pb.collection('inspections').update(id, fd);
	} catch (e) {
		return fail(500, { section: 'signatures', message: `Could not save the signature: ${pbError(e)}` });
	}

	// Confirm the write, then freeze the signed version when both are present.
	try {
		let fresh = (await locals.pb.collection('inspections').getOne(id)) as unknown as Inspection;
		const savedFile = who === 'landlord' ? fresh.sig_landlord : fresh.sig_tenant;
		if (!savedFile) {
			return fail(500, { section: 'signatures', message: 'Signature save could not be confirmed.' });
		}
		let both = false;
		let deliveryNote = '';
		if (fresh.sig_landlord && fresh.sig_tenant) {
			// Finalization gate: both signatures must apply to the same saved
			// content. Edits after a signature fork a new revision, so this is
			// structural — the check exists to fail loudly rather than ever sign
			// mismatched content.
			if (!signaturesCoverSnapshot(fresh)) {
				return fail(400, {
					section: 'signatures',
					message: 'Content changed between signatures — save a fresh revision and sign again.'
				});
			}
			const signed_snapshot = {
				address: fresh.address,
				unit: fresh.unit,
				tenant_names: fresh.tenant_names,
				occupancy: fresh.occupancy,
				move_in_date: fresh.move_in_date,
				move_out_date: fresh.move_out_date,
				date: fresh.date,
				type: fresh.type,
				notes: fresh.notes,
				checklist: parseChecklist(fresh.checklist),
				proposed_deductions: parseDeductions(fresh.proposed_deductions),
				signed_completed_at: new Date().toISOString()
			};

			// Persist the final report PDF FIRST — the signed stage is set only
			// after signatures, snapshot, and the PDF are all durably stored.
			const checklistNow = parseChecklist(fresh.checklist);
			const pdf = buildInspectionPdf({
				address: fresh.address,
				unit: fresh.unit,
				type: fresh.type,
				date: String(fresh.date).slice(0, 10),
				tenantNames: fresh.tenant_names,
				itemsOk: checklistNow.filter((c) => !c.flagged).length,
				itemsFlagged: checklistNow.filter((c) => c.flagged).length,
				landlordName: fresh.sig_landlord_name,
				landlordAt: fresh.sig_landlord_at,
				tenantName: fresh.sig_tenant_name,
				tenantAt: fresh.sig_tenant_at,
				signedCompletedAt: signed_snapshot.signed_completed_at
			});
			const pdfFd = new FormData();
			pdfFd.append('final_pdf', new File([pdf as unknown as BlobPart], 'signed-report.pdf', { type: 'application/pdf' }));
			await locals.pb.collection('inspections').update(id, pdfFd);

			await locals.pb.collection('inspections').update(id, { stage: 'signed', signed_snapshot });
			fresh = (await locals.pb
				.collection('inspections')
				.getOne(id, { expand: 'lease,lease.tenant,created_by' })) as unknown as Inspection;
			both = fresh.stage === 'signed' && !!fresh.signed_snapshot && !!fresh.final_pdf;
			if (!both) {
				return fail(500, {
					section: 'signatures',
					message: 'Both signatures saved, but the signed snapshot or final PDF could not be confirmed.'
				});
			}

			// Email confirmation — after signing is fully persisted. A delivery
			// failure is recorded per recipient and never undoes the signing.
			// Recipient resolution runs with the superuser client (server-side record
			// access; per-record emailVisibility doesn't gate it).
			try {
				const suPb = await createSuperuserClient();
				const delivery = await notifySignedInspection(
					suPb,
					fresh,
					appBaseUrl(PUBLIC_APP_URL, { production: isExplicitProduction() })
				);
				deliveryNote = ` Email confirmation: ${delivery.sent} sent, ${delivery.pending} pending (email disabled), ${delivery.failed} failed.`;
				if (delivery.limitations.length > 0) deliveryNote += ` Note: ${delivery.limitations.join(' ')}`;
			} catch {
				deliveryNote = ' Email confirmation could not be attempted — the signed report is unaffected.';
			}
		}
		return {
			section: 'signatures',
			message:
				`${who === 'landlord' ? 'Landlord' : 'Tenant'} signature saved.` +
				(both ? ' Both signatures captured — the report is fully signed.' + deliveryNote : '')
		};
	} catch (e) {
		return fail(500, { section: 'signatures', message: `Could not confirm the signature: ${pbError(e)}` });
	}
}

export const actions: Actions = {
	saveDraft: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
			return fail(403, { section: 'inspection', message: 'Management access required.' });
		}
		return save(event, true);
	},

	saveInspection: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
			return fail(403, { section: 'inspection', message: 'Management access required.' });
		}
		return save(event, false);
	},

	createRevisionInspection: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
			return fail(403, { section: 'inspection', message: 'Management access required.' });
		}
		const id = event.params.id!;
		const current = (await event.locals.pb.collection('inspections').getOne(id).catch(() => null)) as unknown as Inspection | null;
		if (!current) return fail(404, { section: 'inspection', message: 'Inspection not found.' });
		if (current.stage === 'completed') {
			return fail(400, {
				section: 'inspection',
				message: 'This inspection is already completed and read-only.'
			});
		}
		if (!(current.sig_landlord || current.sig_tenant)) {
			return fail(400, {
				section: 'inspection',
				message: 'This inspection has no signed version yet. Save edits directly.'
			});
		}
		try {
			const revision = await event.locals.pb.collection('inspections').create({
				lease: current.lease || '',
				date: current.date,
				type: current.type,
				notes: current.notes,
				address: current.address,
				unit: current.unit,
				tenant_names: current.tenant_names,
				occupancy: current.occupancy,
				move_in_date: current.move_in_date,
				move_out_date: current.move_out_date,
				stage: 'draft',
				created_by: user.id,
				checklist: current.checklist,
				proposed_deductions: current.proposed_deductions,
				manager_notes: '',
				revision_of: id,
				sig_landlord: '',
				sig_landlord_name: '',
				sig_landlord_at: '',
				sig_landlord_meta: '',
				sig_tenant: '',
				sig_tenant_name: '',
				sig_tenant_at: '',
				sig_tenant_meta: '',
				signed_snapshot: null,
				final_pdf: '',
				signed_copy: '',
			});
			throw redirect(303, `/dashboard/inspections/${revision.id}?revised=1`);
		} catch (e) {
			if (typeof e === 'object' && e && 'status' in e && 'location' in e) {
				throw e;
			}
			return fail(500, {
				section: 'inspection',
				message: `Could not create a revised inspection: ${pbError(e)}`
			});
		}
	},

	removeItemPhoto: async ({ request, locals, params }) => {
		const id = params.id!;
		const user = locals.user!;
		const form = await request.formData();
		const docId = String(form.get('document_id') ?? '');
		if (!docId) return fail(400, { section: 'inspection', message: 'Missing photo id.' });
		try {
			const insp = (await locals.pb
				.collection('inspections')
				.getOne(id)) as unknown as Inspection;
			if (insp.sig_landlord || insp.sig_tenant) {
				return fail(400, {
					section: 'inspection',
					message: 'This inspection has signatures — attachments are preserved with the signed version.'
				});
			}
			const doc = (await locals.pb.collection('documents').getOne(docId)) as unknown as DocRecord;
			if (doc.kind !== 'inspection' && doc.kind !== 'receipt') {
				return fail(400, { section: 'inspection', message: 'That file is not an inspection attachment.' });
			}
			await locals.pb.collection('documents').delete(docId);
			// Drop the reference from the stored checklist so a reopen never sees it.
			const inspection = (await locals.pb
				.collection('inspections')
				.getOne(id)) as unknown as Inspection;
			const checklist = parseChecklist(inspection.checklist).map((c) => ({
				...c,
				moveIn: { ...c.moveIn, photos: c.moveIn.photos.filter((p) => p !== docId) },
				moveOut: { ...c.moveOut, photos: c.moveOut.photos.filter((p) => p !== docId) }
			}));
			await locals.pb.collection('inspections').update(id, { checklist });
		} catch (e) {
			return fail(500, { section: 'inspection', message: `Could not remove photo: ${pbError(e)}` });
		}
		return { section: 'inspection', message: 'Photo removed.', removedPhoto: docId };
	},

	finalizeInspection: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
			return fail(403, { section: 'inspection', message: 'Management access required.' });
		}
		const id = event.params.id!;
		const current = (await event.locals.pb.collection('inspections').getOne(id).catch(() => null)) as unknown as Inspection | null;
		if (!current) {
			return fail(404, { section: 'inspection', message: 'Inspection not found.' });
		}
		if (current.stage === 'completed') {
			return fail(400, { section: 'inspection', message: 'This inspection is already completed and read-only.' });
		}
		if (!(current.sig_landlord && current.sig_tenant)) {
			return fail(400, {
				section: 'inspection',
				message: 'Both signatures must be saved before the inspection can be completed.'
			});
		}
		// Finalizing also saves the current form contents so nothing is lost.
		const result = await save(event, false, { allowSigned: true });
		if (result && typeof result === 'object' && 'status' in result) return result;
		try {
			await event.locals.pb.collection('inspections').update(id, { stage: 'completed' });
			const fresh = await event.locals.pb.collection('inspections').getOne(id);
			if (fresh.stage !== 'completed') {
				return fail(500, { section: 'inspection', message: 'Finalize could not be confirmed.' });
			}
		} catch (e) {
			return fail(500, { section: 'inspection', message: `Finalize failed: ${pbError(e)}` });
		}
		return { section: 'inspection', message: 'Inspection saved and finalized. It is now read-only.' };
	},

	uploadSignedCopy: async ({ request, locals, params }) => {
		const id = params.id!;
		const current = (await locals.pb
			.collection('inspections')
			.getOne(id)
			.catch(() => null)) as unknown as Inspection | null;
		if (current?.stage === 'completed') {
			return fail(400, {
				section: 'signed',
				message: 'This inspection is finalized — its signed copy is preserved and cannot be replaced.'
			});
		}
		const form = await request.formData();
		const file = form.get('signed_copy');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { section: 'signed', message: 'Choose the signed copy file first.' });
		}
		if (!ALLOWED_FILE_TYPES.includes(file.type)) {
			return fail(400, {
				section: 'signed',
				message: `"${file.name}" is not allowed — only PDF, JPEG, or PNG files.`
			});
		}
		try {
			const fd = new FormData();
			fd.append('signed_copy', file);
			await locals.pb.collection('inspections').update(id, fd);
		} catch (e) {
			return fail(500, { section: 'signed', message: `Upload failed: ${pbError(e)}` });
		}
		return { section: 'signed', message: 'Signed copy uploaded.' };
	},

	signLandlord: async (event) => sign(event, 'landlord'),
	signTenant: async (event) => sign(event, 'tenant'),

	// Retry pending/failed email deliveries for this signed inspection. Rows
	// marked sent are never touched — no duplicate emails.
	resendInspectionNotice: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
			return fail(403, { section: 'notify', message: 'Management access required.' });
		}
		const id = event.params.id!;
		const inspection = (await event.locals.pb
			.collection('inspections')
			.getOne(id, { expand: 'lease,lease.tenant,created_by' })
			.catch(() => null)) as unknown as Inspection | null;
		if (!inspection) return fail(404, { section: 'notify', message: 'Inspection not found.' });
		const suPb = await createSuperuserClient();
		const result = await retryFailedNotifications(
			suPb,
			inspection,
			appBaseUrl(PUBLIC_APP_URL, { production: isExplicitProduction() })
		);
		return {
			section: 'notify',
			message: `Retried ${result.retried} deliver${result.retried === 1 ? 'y' : 'ies'}: ${result.sent} sent, ${result.failed} failed.`
		};
	}
};
