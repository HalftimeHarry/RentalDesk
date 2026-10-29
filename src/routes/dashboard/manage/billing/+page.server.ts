import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { computeRentCharge } from '$lib/billing';
import { summarizeLedger } from '$lib/server/billing';
import { parseMoneyToCents } from '$lib/format';
import { docUrl } from '$lib/files';
import type { Charge, DocRecord, Lease, Payment, UnitSettings, User } from '$lib/types';

function pbError(e: unknown): string {
	const err = e as { response?: { message?: string }; message?: string } | null;
	return err?.response?.message || err?.message || 'unknown error';
}

const BILL_KINDS = ['rent_full', 'rent_partial', 'utility_att', 'utility_sdge'] as const;
type BillKind = (typeof BILL_KINDS)[number];

const UTILITY_LABELS: Record<string, string> = {
	utility_att: 'AT&T reimbursement',
	utility_sdge: 'SDG&E reimbursement'
};

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	let lease: Lease | null = null;
	try {
		lease = (await pb
			.collection('leases')
			.getFirstListItem('status = "active"', { expand: 'tenant' })) as unknown as Lease;
	} catch {
		lease = null;
	}

	let settings: UnitSettings | null = null;
	try {
		const list = await pb.collection('settings').getList(1, 1, { sort: 'created' });
		settings = list.items.length > 0 ? (list.items[0] as unknown as UnitSettings) : null;
	} catch {
		settings = null;
	}

	if (!lease) return { user, lease, settings, charges: [], payments: [], ledger: summarizeLedger([], []), billDocs: {}, today: new Date().toISOString().slice(0, 10) };

	const [charges, payments] = await Promise.all([
		pb
			.collection('charges')
			.getFullList({ filter: `lease = "${lease.id}"`, sort: 'due_date,created' })
			.then((r) => r as unknown as Charge[])
			.catch(() => [] as Charge[]),
		pb
			.collection('payments')
			.getFullList({ filter: `lease = "${lease.id}"`, sort: '-date' })
			.then((r) => r as unknown as Payment[])
			.catch(() => [] as Payment[])
	]);

	// Bill attachments for these charges.
	const billDocs: Record<string, DocRecord & { url: string }> = {};
	try {
		const docs = (await pb
			.collection('documents')
			.getFullList({ filter: `lease = "${lease.id}" && kind = "bill"` })) as unknown as DocRecord[];
		for (const d of docs) {
			if (d.charge) billDocs[d.charge] = { ...d, url: docUrl(d.id, d.file) };
		}
	} catch {
		// none
	}

	// Balance figures include only published charges (drafts stay management-only).
	const published = charges.filter((c) => c.status === 'published');
	return {
		user,
		lease,
		settings,
		charges,
		payments,
		ledger: summarizeLedger(published, payments),
		billDocs,
		today: new Date().toISOString().slice(0, 10)
	};
};

/** True when an identical charge already exists (duplicate submission guard). */
async function isExactDuplicate(pb: App.Locals['pb'], data: Record<string, unknown>): Promise<boolean> {
	try {
		const candidates = (await pb
			.collection('charges')
			.getFullList({
				filter: `lease = "${data.lease}" && type = "${data.type}" && amount_cents = ${data.amount_cents}`
			})) as unknown as Charge[];
		// PocketBase stores datetimes with a time component — compare by calendar day.
		return candidates.some(
			(c) =>
				c.description === data.description &&
				String(c.period_start ?? '').slice(0, 10) === String(data.period_start ?? '').slice(0, 10) &&
				String(c.period_end ?? '').slice(0, 10) === String(data.period_end ?? '').slice(0, 10)
		);
	} catch {
		return false;
	}
}

/** Overlapping rent periods produce a warning (distinct partial + full months are allowed). */
async function overlapWarning(pb: App.Locals['pb'], leaseId: string, start: string, end: string): Promise<string> {
	if (!start || !end) return '';
	try {
		const hits = await pb
			.collection('charges')
			.getFullList({
				filter: `lease = "${leaseId}" && type = "rent" && period_start <= "${end}" && period_end >= "${start}" && period_start != ""`
			});
		if (hits.length === 0) return '';
		return `Warning: overlaps ${hits.length} existing rent charge${hits.length === 1 ? '' : 's'} (${hits
			.map((h) => `${h.period_start} – ${h.period_end}`)
			.join(', ')}). Saved anyway — review for duplicates.`;
	} catch {
		return '';
	}
}

export const actions: Actions = {
	createCharge: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '') as BillKind;
		const leaseId = String(form.get('lease') ?? '');
		const publish = form.get('publish') === '1';
		const dueDate = String(form.get('due_date') ?? '');
		const note = String(form.get('note') ?? '').trim();

		if (!leaseId || !BILL_KINDS.includes(kind)) {
			return fail(400, { section: 'composer', message: 'Choose a charge type.' });
		}
		if (!dueDate) return fail(400, { section: 'composer', message: 'A due date is required.' });

		let lease: Lease;
		try {
			lease = (await locals.pb.collection('leases').getOne(leaseId)) as unknown as Lease;
		} catch {
			return fail(404, { section: 'composer', message: 'Lease not found.' });
		}

		// Settings fallback for the default monthly rent; lease wins when set.
		let settingsRent = 0;
		try {
			const s = await locals.pb.collection('settings').getList(1, 1, { sort: 'created' });
			settingsRent = s.items.length > 0 ? (s.items[0] as unknown as UnitSettings).monthly_rent_cents : 0;
		} catch {
			settingsRent = 0;
		}
		const defaultRent = lease.monthly_rent_cents || settingsRent;

		let data: Record<string, unknown>;

		if (kind === 'rent_full') {
			const month = String(form.get('month') ?? ''); // YYYY-MM
			if (!/^\d{4}-\d{2}$/.test(month)) {
				return fail(400, { section: 'composer', message: 'Select the rental month.' });
			}
			const override = parseMoneyToCents(form.get('amount_override'));
			const amount = override ?? defaultRent;
			if (amount <= 0) return fail(400, { section: 'composer', message: 'Rent amount missing (lease and settings).' });
			const [y, m] = month.split('-').map(Number);
			const lastDay = new Date(y, m, 0).getDate();
			const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
			data = {
				lease: leaseId,
				type: 'rent',
				description: `Rent — ${label}`,
				amount_cents: amount,
				due_date: dueDate,
				period: month,
				period_start: `${month}-01`,
				period_end: `${month}-${String(lastDay).padStart(2, '0')}`,
				prorated: false,
				status: publish ? 'published' : 'draft',
				calc: {
					monthly_rate_cents: amount,
					basis: 'full',
					billable_days: lastDay,
					...(override !== null && override !== lease.monthly_rent_cents
						? { override: { amount_cents: override, reason: note || 'authorized rent override' } }
						: {})
				}
			};
		} else if (kind === 'rent_partial') {
			const basis = String(form.get('basis') ?? '30-day') === 'actual' ? 'actual' : '30-day';
			const method = String(form.get('method') ?? 'days') === 'range' ? 'range' : 'days';
			const result = computeRentCharge({
				monthlyRentCents: defaultRent,
				basis,
				mode: method,
				days: Number(form.get('days') ?? 0),
				start: String(form.get('start') ?? ''),
				end: String(form.get('end') ?? '')
			});
			if ('error' in result) return fail(400, { section: 'composer', message: result.error });

			const override = parseMoneyToCents(form.get('override_amount'));
			const overrideReason = String(form.get('override_reason') ?? '').trim();
			let amount = result.amount_cents;
			const calc: Record<string, unknown> = { ...result };
			if (override !== null && override !== result.amount_cents) {
				if (!overrideReason) {
					return fail(400, {
						section: 'composer',
						message: 'A manual amount override needs an explanation.'
					});
				}
				calc.override = { amount_cents: override, reason: overrideReason };
				amount = override;
			}

			const startLabel = result.period_start || '—';
			const endLabel = result.period_end || '—';
			data = {
				lease: leaseId,
				type: 'rent',
				description:
					`Prorated rent — ${startLabel} to ${endLabel} ` +
					`(${result.billable_days} billable day${result.billable_days === 1 ? '' : 's'}, ` +
					`${basis === '30-day' ? '30-day month' : 'actual calendar days'})`,
				amount_cents: amount,
				due_date: dueDate,
				period: result.period_start.slice(0, 7),
				period_start: result.period_start,
				period_end: result.period_end,
				prorated: true,
				status: publish ? 'published' : 'draft',
				calc
			};
		} else {
			// Utilities: manual reimbursement amounts with service period + bill attachment.
			const amount = parseMoneyToCents(form.get('amount'));
			const servicePeriod = String(form.get('service_period') ?? '').trim();
			if (amount === null || amount <= 0) {
				return fail(400, { section: 'composer', message: 'Enter the reimbursement amount.' });
			}
			if (!servicePeriod) {
				return fail(400, { section: 'composer', message: 'Enter the service period (e.g. Oct 2026).' });
			}
			data = {
				lease: leaseId,
				type: 'other',
				description: `${UTILITY_LABELS[kind]} — service ${servicePeriod}`,
				amount_cents: amount,
				due_date: dueDate,
				period: '',
				period_start: '',
				period_end: '',
				prorated: false,
				status: publish ? 'published' : 'draft',
				calc: null
			};
		}

		if (note) data.description = `${data.description} — ${note}`;

		if (await isExactDuplicate(locals.pb, data)) {
			return fail(400, {
				section: 'composer',
				message: 'An identical charge already exists — duplicate submission prevented.'
			});
		}

		let warning = '';
		if (data.type === 'rent') {
			warning = await overlapWarning(
				locals.pb,
				leaseId,
				String(data.period_start),
				String(data.period_end)
			);
		}

		let created: Charge;
		try {
			created = (await locals.pb.collection('charges').create(data)) as unknown as Charge;
		} catch (e) {
			return fail(500, { section: 'composer', message: `Save failed: ${pbError(e)}` });
		}

		// Optional bill attachment (utilities).
		const billFile = form.get('bill_file');
		if (billFile instanceof File && billFile.size > 0) {
			if (!['application/pdf', 'image/jpeg', 'image/png'].includes(billFile.type)) {
				return fail(400, { section: 'composer', message: 'Bill attachment must be PDF, JPEG, or PNG. The charge was saved without it.' });
			}
			try {
				const fd = new FormData();
				fd.append('owner', user.id);
				fd.append('kind', 'bill');
				fd.append('lease', leaseId);
				fd.append('charge', created.id);
				fd.append('title', `${data.description} — ${billFile.name}`);
				fd.append('file', billFile);
				await locals.pb.collection('documents').create(fd);
			} catch (e) {
				return fail(500, {
					section: 'composer',
					message: `Charge saved, but the bill attachment failed: ${pbError(e)}`
				});
			}
		}

		// Confirm the write before reporting success.
		try {
			const fresh = await locals.pb.collection('charges').getOne(created.id);
			if (fresh.amount_cents !== data.amount_cents || fresh.status !== data.status) {
				return fail(500, { section: 'composer', message: 'Save could not be confirmed.' });
			}
		} catch (e) {
			return fail(500, { section: 'composer', message: `Save could not be confirmed: ${pbError(e)}` });
		}

		return {
			section: 'composer',
			message:
				(publish ? 'Charge published.' : 'Draft saved.') + (warning ? ` ${warning}` : ''),
			warning
		};
	},

	publishCharge: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			await locals.pb.collection('charges').update(id, { status: 'published' });
			const fresh = await locals.pb.collection('charges').getOne(id);
			if (fresh.status !== 'published') {
				return fail(500, { section: 'charges', message: 'Publish could not be confirmed.' });
			}
		} catch (e) {
			return fail(500, { section: 'charges', message: `Publish failed: ${pbError(e)}` });
		}
		return { section: 'charges', message: 'Charge published — the tenant can now see it.' };
	},

	deleteDraft: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			const charge = await locals.pb.collection('charges').getOne(id);
			if (charge.status !== 'draft') {
				return fail(400, { section: 'charges', message: 'Only drafts can be deleted.' });
			}
			await locals.pb.collection('charges').delete(id);
		} catch (e) {
			return fail(500, { section: 'charges', message: `Delete failed: ${pbError(e)}` });
		}
		return { section: 'charges', message: 'Draft deleted.' };
	},

	recordPayment: async ({ request, locals }) => {
		const user = locals.user!;
		const form = await request.formData();
		const chargeId = String(form.get('charge') ?? '');
		const amount = parseMoneyToCents(form.get('amount'));
		const date = String(form.get('date') ?? '');
		const method = String(form.get('method') ?? 'other');
		const reference = String(form.get('reference') ?? '').trim();
		const note = String(form.get('note') ?? '').trim();

		if (!chargeId || amount === null || amount <= 0 || !date) {
			return fail(400, { section: `pay-${chargeId}`, message: 'Amount and date are required.' });
		}
		if (!['zelle', 'cash', 'check', 'venmo', 'bank_transfer', 'other'].includes(method)) {
			return fail(400, { section: `pay-${chargeId}`, message: 'Invalid payment method.' });
		}

		let charge: Charge;
		try {
			charge = (await locals.pb.collection('charges').getOne(chargeId)) as unknown as Charge;
		} catch {
			return fail(404, { section: `pay-${chargeId}`, message: 'Charge not found.' });
		}

		// Don't record beyond the remaining balance.
		const paid = await locals.pb
			.collection('payments')
			.getFullList({ filter: `charge = "${chargeId}"` })
			.then((r) => (r as unknown as Payment[]).reduce((s, p) => s + p.amount_cents, 0))
			.catch(() => 0);
		const remaining = charge.amount_cents - paid;
		if (remaining <= 0) {
			return fail(400, { section: `pay-${chargeId}`, message: 'This charge is already fully paid.' });
		}
		if (amount > remaining) {
			return fail(400, {
				section: `pay-${chargeId}`,
				message: `Amount exceeds the remaining balance (${(remaining / 100).toFixed(2)}).`
			});
		}

		// Duplicate guard: identical payment on the same charge within the same minute.
		// (PocketBase stores datetimes with a time component — compare by calendar day.)
		try {
			const candidates = (await locals.pb
				.collection('payments')
				.getFullList({
					filter: `charge = "${chargeId}" && amount_cents = ${amount} && method = "${method}"`,
					sort: '-created'
				})) as unknown as Payment[];
			const dup = candidates.find(
				(p) => String(p.date).slice(0, 10) === date && Date.now() - new Date(p.created).getTime() < 60_000
			);
			if (dup) {
				return fail(400, {
					section: `pay-${chargeId}`,
					message: 'That exact payment was just recorded — duplicate prevented.'
				});
			}
		} catch {
			// no duplicate
		}

		try {
			await locals.pb.collection('payments').create({
				lease: charge.lease,
				charge: chargeId,
				amount_cents: amount,
				date,
				method,
				applies_to: charge.type === 'deposit' ? 'deposit' : 'rent',
				reference,
				note,
				recorded_by: user.id
			});
		} catch (e) {
			return fail(500, { section: `pay-${chargeId}`, message: `Save failed: ${pbError(e)}` });
		}
		return { section: `pay-${chargeId}`, message: 'Payment recorded.' };
	}
};
