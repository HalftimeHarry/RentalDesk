import { fail, redirect, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { parseChecklist, parseDeductions, type ChecklistItem } from '$lib/inspection';
import { parseMoneyToCents } from '$lib/format';
import type { DocRecord, Inspection } from '$lib/types';

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

	return {
		user,
		inspection,
		checklist: parseChecklist(inspection.checklist),
		deductions: parseDeductions(inspection.proposed_deductions),
		documents: await loadDocMap(pb, inspection.id)
	};
};

/** Canonical content key — detects real content changes (ignores stage). */
function contentKeyOf(i: Inspection): string {
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
		manager_notes: i.manager_notes,
		checklist: parseChecklist(i.checklist),
		proposed_deductions: parseDeductions(i.proposed_deductions)
	});
}

/** Shared save path for Save draft / Save inspection. */
async function save(event: Parameters<Actions[string]>[0], forceDraft: boolean) {
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
		manager_notes: String(form.get('manager_notes') ?? '').trim(),
		checklist,
		proposed_deductions
	};

	if (!data.address || !data.unit) {
		return fail(400, { section: 'inspection', message: 'Property address and unit are required.' });
	}

	// Signed-version protection: editing content after any signature exists
	// creates a NEW unsigned revision; the signed record, its signatures, and
	// its signed copy are never overwritten.
	const hasSignature = !!(existing.sig_landlord || existing.sig_tenant);
	let targetId = id;
	let forked = false;
	const incomingKey = JSON.stringify({
		address: data.address,
		unit: data.unit,
		tenant_names: data.tenant_names,
		occupancy: data.occupancy,
		move_in_date: data.move_in_date.slice(0, 10),
		move_out_date: data.move_out_date.slice(0, 10),
		date: data.date.slice(0, 10),
		type: data.type,
		notes: data.notes,
		manager_notes: data.manager_notes,
		checklist,
		proposed_deductions
	});
	if (hasSignature && incomingKey !== contentKeyOf(existing)) {
		try {
			const copy = await locals.pb.collection('inspections').create({
				lease: existing.lease || '',
				date: data.date,
				type: data.type,
				notes: data.notes,
				address: data.address,
				unit: data.unit,
				tenant_names: data.tenant_names,
				occupancy: data.occupancy,
				move_in_date: data.move_in_date,
				move_out_date: data.move_out_date,
				stage: 'draft',
				created_by: user.id,
				checklist,
				proposed_deductions,
				manager_notes: data.manager_notes,
				revision_of: id
			});
			targetId = copy.id;
			forked = true;
			data.stage = 'draft';
		} catch (e) {
			return fail(500, {
				section: 'inspection',
				message: `Could not create an unsigned revision: ${pbError(e)}. Nothing was saved.`
			});
		}
	}

	if (!forked && existing.stage === 'completed') {
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
		if (data.stage === 'signed' && (forked || existing.stage !== 'signed')) {
			data.stage = forked ? 'draft' : 'in_progress';
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

	if (forked) {
		// The signed original is preserved; continue on the new unsigned revision.
		redirect(303, `/dashboard/inspections/${targetId}?forked=1`);
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

	if (existing.stage === 'signed') {
		return fail(400, {
			section: 'signatures',
			message: 'This inspection is already fully signed. Editing content creates a new unsigned revision.'
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
		if (fresh.sig_landlord && fresh.sig_tenant) {
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
			await locals.pb.collection('inspections').update(id, { stage: 'signed', signed_snapshot });
			fresh = (await locals.pb.collection('inspections').getOne(id)) as unknown as Inspection;
			both = fresh.stage === 'signed' && !!fresh.signed_snapshot;
			if (!both) {
				return fail(500, {
					section: 'signatures',
					message: 'Both signatures saved, but the signed snapshot could not be confirmed.'
				});
			}
		}
		return {
			section: 'signatures',
			message:
				`${who === 'landlord' ? 'Landlord' : 'Tenant'} signature saved.` +
				(both ? ' Both signatures captured — the report is fully signed.' : '')
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
		// Finalizing also saves the current form contents so nothing is lost.
		const result = await save(event, false);
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
	signTenant: async (event) => sign(event, 'tenant')
};
