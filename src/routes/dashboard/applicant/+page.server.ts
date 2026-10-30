import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { managementContact } from '$lib/server/messages';
import { parseMoneyToCents } from '$lib/format';
import type { Application, DocRecord, Message, UnitSettings } from '$lib/types';

async function loadData(locals: App.Locals, userId: string) {
	let application: Application | null = null;
	try {
		application = (await locals.pb
			.collection('applications')
			.getFirstListItem(`applicant = "${userId}"`, { sort: '-created' })) as unknown as Application;
	} catch {
		application = null;
	}

	const [documents, messages, contact, settings] = await Promise.all([
		locals.pb
			.collection('documents')
			.getFullList({ filter: `owner = "${userId}"`, sort: '-created' })
			.then((r) => r as unknown as DocRecord[])
			.catch(() => [] as DocRecord[]),
		locals.pb
			.collection('messages')
			.getFullList({
				filter: `sender = "${userId}" || recipient = "${userId}"`,
				sort: 'created',
				expand: 'sender'
			})
			.then((r) => r as unknown as Message[])
			.catch(() => [] as Message[]),
		managementContact(locals.pb),
		// Settings rules are public read (listing page) — fee + payment instructions.
		locals.pb
			.collection('settings')
			.getList(1, 1, { sort: 'created' })
			.then((r) => (r.items.length > 0 ? (r.items[0] as unknown as UnitSettings) : null))
			.catch(() => null)
	]);

	return { application, documents, messages, contact, settings };
}

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['applicant']);
	return { user, ...(await loadData(event.locals, user.id)) };
};

export const actions: Actions = {
	updateContact: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		if (!name) return fail(400, { section: 'contact', message: 'Name is required.' });
		// Only contact fields are updated here — role is never touched.
		await locals.pb.collection('users').update(user.id, { name, phone });
		return { section: 'contact', message: 'Contact details saved.' };
	},

	saveApplication: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();

		const data = {
			applicant: user.id,
			full_name: String(form.get('full_name') ?? '').trim(),
			phone: String(form.get('phone') ?? '').trim(),
			current_address: String(form.get('current_address') ?? '').trim(),
			employer: String(form.get('employer') ?? '').trim(),
			monthly_income_cents: parseMoneyToCents(form.get('monthly_income')) ?? 0,
			move_in_date: String(form.get('move_in_date') ?? ''),
			notes: String(form.get('notes') ?? '').trim()
		};

		if (!data.full_name || !data.phone) {
			return fail(400, { section: 'application', message: 'Full name and phone are required.' });
		}

		let existing: Application | null = null;
		try {
			existing = (await locals.pb
				.collection('applications')
				.getFirstListItem(`applicant = "${user.id}"`)) as unknown as Application;
		} catch {
			existing = null;
		}

		if (existing && existing.status !== 'draft') {
			return fail(400, {
				section: 'application',
				message: 'Your application has already been submitted and can no longer be edited.'
			});
		}

		if (existing) {
			await locals.pb.collection('applications').update(existing.id, data);
		} else {
			await locals.pb.collection('applications').create({ ...data, status: 'draft' });
		}
		return { section: 'application', message: 'Draft saved.' };
	},

	submitApplication: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		let application: Application | null = null;
		try {
			application = (await locals.pb
				.collection('applications')
				.getFirstListItem(`applicant = "${user.id}"`)) as unknown as Application;
		} catch {
			application = null;
		}
		if (!application) {
			return fail(400, { section: 'application', message: 'Save your application first.' });
		}
		if (application.status !== 'draft') {
			return fail(400, { section: 'application', message: 'Application already submitted.' });
		}
		// Snapshot the fee AS PRESENTED — later price changes never alter it.
		// (Pre-migration settings records return 0 for the unset field -> $35 initial.)
		const settings = await locals.pb
			.collection('settings')
			.getList(1, 1, { sort: 'created' })
			.catch(() => null);
		const stored =
			settings && settings.items.length > 0
				? (settings.items[0] as unknown as UnitSettings).screening_fee_cents
				: 0;
		const feeCents = stored > 0 ? stored : 3500;
		// Optional Zelle confirmation/reference — "payment reported", not "paid".
		const ref = String(form.get('screening_payment_ref') ?? '').trim().slice(0, 200);
		await locals.pb.collection('applications').update(application.id, {
			status: 'submitted',
			submitted: new Date().toISOString(),
			screening_fee_cents: feeCents,
			...(ref ? { screening_payment_ref: ref } : {})
		});
		return { section: 'application', message: 'Application submitted.' };
	},

	// Applicant reports their Zelle reference for the screening fee. Allowed after
	// submission too (the fee is typically paid right after applying). Never sets
	// screening_fee_confirmed — only management confirms receipt.
	reportScreeningFee: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const ref = String(form.get('screening_payment_ref') ?? '').trim().slice(0, 200);
		if (!ref) {
			return fail(400, { section: 'screening-fee', message: 'Enter the Zelle confirmation or reference.' });
		}
		let application: Application | null = null;
		try {
			application = (await locals.pb
				.collection('applications')
				.getFirstListItem(`applicant = "${user.id}"`)) as unknown as Application;
		} catch {
			application = null;
		}
		if (!application || application.status === 'draft') {
			return fail(400, { section: 'screening-fee', message: 'Submit your application first.' });
		}
		if (application.screening_fee_confirmed) {
			return fail(400, { section: 'screening-fee', message: 'The fee is already confirmed — no change needed.' });
		}
		await locals.pb
			.collection('applications')
			.update(application.id, { screening_payment_ref: ref });
		return {
			section: 'screening-fee',
			message: 'Payment reported. Management will confirm once the Zelle payment arrives.'
		};
	},

	uploadDocument: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const kind = String(form.get('kind') ?? 'other');
		const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

		if (!title) return fail(400, { section: 'documents', message: 'A title is required.' });
		if (files.length === 0)
			return fail(400, { section: 'documents', message: 'Choose at least one file.' });

		const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png'];
		for (const file of files) {
			if (!ALLOWED.includes(file.type)) {
				return fail(400, {
					section: 'documents',
					message: `"${file.name}" is not allowed — only PDF, JPEG, or PNG files.`
				});
			}
		}

		let applicationId = '';
		try {
			const app = await locals.pb
				.collection('applications')
				.getFirstListItem(`applicant = "${user.id}"`);
			applicationId = app.id;
		} catch {
			// no application yet — documents can still be uploaded
		}

		for (const file of files) {
			const payload = new FormData();
			payload.append('owner', user.id);
			payload.append('title', files.length > 1 ? `${title} — ${file.name}` : title);
			payload.append('kind', kind);
			payload.append('file', file);
			if (applicationId) payload.append('application', applicationId);
			await locals.pb.collection('documents').create(payload);
		}
		return { section: 'documents', message: `${files.length} document(s) uploaded.` };
	},

	deleteDocument: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			const doc = (await locals.pb.collection('documents').getOne(id)) as unknown as DocRecord;
			if (doc.owner !== user.id) {
				return fail(403, { section: 'documents', message: 'You can only delete your own documents.' });
			}
			await locals.pb.collection('documents').delete(id);
		} catch {
			return fail(400, { section: 'documents', message: 'Could not delete the document.' });
		}
		return { section: 'documents', message: 'Document deleted.' };
	},

	sendMessage: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		if (!body) return fail(400, { section: 'messages', message: 'Message cannot be empty.' });

		// Applicants always message the management team, never a role they chose.
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
	}
};
