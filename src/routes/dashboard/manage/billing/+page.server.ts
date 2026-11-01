import { fail, type Actions } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { getDefaultLease } from '$lib/server/lease';
import { computeRentCharge } from '$lib/billing';
import { gatherPendingPublicationBlockers, getLeaseCharges, summarizeLedger, validatePublicationReadiness } from '$lib/server/billing';
import { isWithinWindow, publishWindow, laWallToUtcIso, formatLaDateTime } from '$lib/schedule';
import { parseMoneyToCents } from '$lib/format';
import { docUrl } from '$lib/files';
import type { Charge, DocRecord, HelpVideo, Lease, Payment, UnitSettings, User } from '$lib/types';

function pbError(e: unknown): string {
	const err = e as { response?: { message?: string }; message?: string } | null;
	return err?.response?.message || err?.message || 'unknown error';
}

const BILL_KINDS = ['rent_full', 'rent_partial', 'utility_att', 'utility_sdge', 'deposit', 'other'] as const;
type BillKind = (typeof BILL_KINDS)[number];

const UTILITY_LABELS: Record<string, string> = {
	utility_att: 'AT&T reimbursement',
	utility_sdge: 'SDG&E reimbursement'
};

export const load: PageServerLoad = async (event) => {
	const user = requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	// Default: active lease if one exists, otherwise the most recent lease — an
	// ended lease still has charges that must remain visible and payable.
	const { lease: activeLease, error: leaseError } = await getDefaultLease(pb);

	// Every lease visible to management, for the lease selector. With more than one
	// active/existing lease, "newest active" is ambiguous — an explicit ?lease=
	// param always wins.
	let leases: Lease[] = [];
	let leasesError: string | null = null;
	try {
		leases = (await pb
			.collection('leases')
			.getFullList({ sort: '-created', expand: 'tenant' })) as unknown as Lease[];
	} catch (e) {
		leasesError = pbError(e);
	}
	const requestedId = event.url.searchParams.get('lease') ?? '';
	const lease = (requestedId && leases.find((l) => l.id === requestedId)) || activeLease;

	let settings: UnitSettings | null = null;
	try {
		const list = await pb.collection('settings').getList(1, 1, { sort: 'created' });
		settings = list.items.length > 0 ? (list.items[0] as unknown as UnitSettings) : null;
	} catch {
		settings = null;
	}

	let helpVideos: HelpVideo[] = [];
	try {
		helpVideos = (await pb
			.collection('help_videos')
			.getFullList({
				filter: 'active = true && audience = "admin" && placement = "manage_billing"',
				sort: 'created'
			})) as unknown as HelpVideo[];
	} catch {
		helpVideos = [];
	}

	if (!lease)
		return { user, lease, leaseError, leases, leasesError, settings, charges: [], payments: [], chargesError: null, paymentsError: null, ledger: summarizeLedger([], []), billDocs: {}, helpVideos, today: new Date().toISOString().slice(0, 10) };

	// Surface query failures instead of silently rendering an empty list.
	// Charges come from the shared loader the tenant view also uses — identical
	// records and ordering on both sides; drafts included here (management).
	const [chargesRes, paymentsRes] = await Promise.all([
		getLeaseCharges(pb, lease.id),
		pb
			.collection('payments')
			.getFullList({ filter: `lease = "${lease.id}"`, sort: '-date' })
			.then((r) => ({ ok: true as const, records: r as unknown as Payment[] }))
			.catch((e) => ({ ok: false as const, error: pbError(e) }))
	]);
	const charges = chargesRes.error ? [] : chargesRes.charges;
	const payments = paymentsRes.ok ? paymentsRes.records : [];
	const chargesError = chargesRes.error;
	const paymentsError = paymentsRes.ok ? null : paymentsRes.error;

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
		leaseError,
		leases,
		leasesError,
		settings,
		charges,
		payments,
		chargesError,
		paymentsError,
		ledger: summarizeLedger(published, payments),
		billDocs,
		helpVideos,
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

function canManageChargeEdits(role?: string | null): boolean {
	return role === 'owner' || role === 'admin';
}

function validateChargeEdit(input: {
	description: string;
	amountCents: number | null;
	paidCents: number;
}): { ok: true; description: string; amountCents: number } | { ok: false; message: string } {
	const description = input.description.trim();
	if (!description) return { ok: false, message: 'Description is required.' };
	if (input.amountCents === null || !Number.isFinite(input.amountCents) || input.amountCents <= 0) {
		return { ok: false, message: 'Enter a valid amount.' };
	}
	if (input.amountCents < input.paidCents) {
		return {
			ok: false,
			message: `Amount cannot be lower than $${(input.paidCents / 100).toFixed(2)} already recorded.`
		};
	}
	return { ok: true, description, amountCents: input.amountCents };
}

function validateMonthPublicationBlockers(drafts: Charge[]): { ok: true } | { ok: false; message: string } {
	const blockers = gatherPendingPublicationBlockers(drafts);
	if (blockers.length === 0) return { ok: true };
	return {
		ok: false,
		message: `Pending amount${blockers.length === 1 ? '' : 's'} prevent publication: ${blockers.join(', ')}.`
	};
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
				preview_visible: false,
				amount_pending: false,
				calc
			};
		} else if (kind === 'deposit') {
			// Security deposit: one charge per lease, amount defaults to the lease requirement.
			const existingDeposit = await locals.pb
				.collection('charges')
				.getFirstListItem(`lease = "${leaseId}" && type = "deposit"`)
				.catch(() => null);
			if (existingDeposit) {
				return fail(400, {
					section: 'composer',
					message: 'A security deposit charge already exists for this lease — duplicate prevented.'
				});
			}
			const amount = parseMoneyToCents(form.get('amount')) ?? lease.deposit_cents;
			if (!amount || amount <= 0) {
				return fail(400, {
					section: 'composer',
					message: 'Deposit amount missing (set it on the lease or enter one).'
				});
			}
			data = {
				lease: leaseId,
				type: 'deposit',
				description: 'Security deposit',
				amount_cents: amount,
				due_date: dueDate,
				period: '',
				period_start: '',
				period_end: '',
				prorated: false,
				status: publish ? 'published' : 'draft',
				preview_visible: false,
				amount_pending: false,
				calc: null
			};
		} else if (kind === 'other') {
			// One-off non-utility charge with a billing month (e.g. credit-check reimbursement).
			const description = String(form.get('description') ?? '').trim();
			const amount = parseMoneyToCents(form.get('amount'));
			const billingMonth = String(form.get('billing_month') ?? '');
			if (!description) {
				return fail(400, {
					section: 'composer',
					message: 'Enter a description (e.g. Credit-check reimbursement).'
				});
			}
			if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
				return fail(400, { section: 'composer', message: 'Select the billing month.' });
			}
			if (amount === null || amount <= 0) {
				return fail(400, { section: 'composer', message: 'Enter the amount.' });
			}
			data = {
				lease: leaseId,
				type: 'other',
				description,
				amount_cents: amount,
				due_date: dueDate,
				period: billingMonth,
				period_start: '',
				period_end: '',
				prorated: false,
				status: publish ? 'published' : 'draft',
				preview_visible: false,
				amount_pending: false,
				calc: null
			};
		} else {
			// Utilities: billing month groups the statement; service period stays text.
			const amount = parseMoneyToCents(form.get('amount'));
			const servicePeriod = String(form.get('service_period') ?? '').trim();
			const billingMonth = String(form.get('billing_month') ?? '');
			if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
				return fail(400, { section: 'composer', message: 'Select the billing month.' });
			}
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
				period: billingMonth,
				period_start: '',
				period_end: '',
				prorated: false,
				status: publish ? 'published' : 'draft',
				preview_visible: false,
				amount_pending: false,
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

	editCharge: async ({ request, locals }) => {
		const user = locals.user;
		if (!canManageChargeEdits(user?.role)) {
			return fail(403, { section: 'charges', message: 'Management-only action.' });
		}
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const description = String(form.get('description') ?? '').trim();
		const amount = parseMoneyToCents(form.get('amount'));
		if (!id) {
			return fail(400, { section: 'charges', message: 'Charge not found.' });
		}
		let charge: Charge;
		try {
			charge = (await locals.pb.collection('charges').getOne(id)) as unknown as Charge;
		} catch {
			return fail(404, { section: 'charges', message: 'Charge not found.' });
		}
		const paidCents = (await locals.pb
			.collection('payments')
			.getFullList({ filter: `charge = "${id}"` })
			.then((rows) => (rows as unknown as Payment[]).reduce((s, p) => s + p.amount_cents, 0))
			.catch(() => 0));
		const valid = validateChargeEdit({ description, amountCents: amount, paidCents });
		if (!valid.ok) {
			return fail(400, { section: `edit-${id}`, message: valid.message });
		}
		try {
			await locals.pb.collection('charges').update(id, {
				description: valid.description,
				amount_cents: valid.amountCents,
				amount_pending: false
			});
		} catch (e) {
			return fail(500, { section: `edit-${id}`, message: `Update failed: ${pbError(e)}` });
		}
		return { section: 'charges', message: 'Charge updated.' };
	},

	togglePreview: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const visible = form.get('preview_visible') === '1';
		if (!id) return fail(400, { section: 'charges', message: 'Charge not found.' });
		try {
			const charge = await locals.pb.collection('charges').getOne(id) as unknown as Charge;
			if (charge.status !== 'draft') {
				return fail(400, { section: 'charges', message: 'Only draft charges can show a tenant preview.' });
			}
			await locals.pb.collection('charges').update(id, { preview_visible: visible });
		} catch (e) {
			return fail(500, { section: 'charges', message: `Preview update failed: ${pbError(e)}` });
		}
		return {
			section: 'charges',
			message: visible ? 'Tenant preview enabled.' : 'Tenant preview withdrawn.'
		};
	},

	togglePendingAmount: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const pending = form.get('amount_pending') === '1';
		if (!id) return fail(400, { section: 'charges', message: 'Charge not found.' });
		try {
			const charge = await locals.pb.collection('charges').getOne(id) as unknown as Charge;
			if (charge.status !== 'draft') {
				return fail(400, { section: 'charges', message: 'Only draft charges can mark an amount as pending.' });
			}
			await locals.pb.collection('charges').update(id, { amount_pending: pending });
		} catch (e) {
			return fail(500, { section: 'charges', message: `Amount status update failed: ${pbError(e)}` });
		}
		return {
			section: 'charges',
			message: pending ? 'Amount marked as pending — publication is blocked until a real amount is entered.' : 'Amount is no longer pending.'
		};
	},

	publishCharge: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			const charge = await locals.pb.collection('charges').getOne(id) as unknown as Charge;
			const readiness = validatePublicationReadiness(charge);
			if (!readiness.ok) {
				return fail(400, { section: 'charges', message: readiness.message });
			}
			await locals.pb.collection('charges').update(id, { status: 'published', preview_visible: false });
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

		// Optional split: alloc-<chargeId> fields allocate the total across charges.
		const allocs: { id: string; cents: number }[] = [];
		for (const [key, value] of form.entries()) {
			if (!key.startsWith('alloc-')) continue;
			const cents = parseMoneyToCents(value);
			if (cents === null || cents <= 0) continue;
			const id = key.slice('alloc-'.length);
			if (allocs.some((a) => a.id === id)) {
				return fail(400, { section: `pay-${chargeId}`, message: 'Duplicate allocation row.' });
			}
			allocs.push({ id, cents });
		}
		if (allocs.length > 0) {
			const sum = allocs.reduce((s, a) => s + a.cents, 0);
			if (sum !== amount) {
				return fail(400, {
					section: `pay-${chargeId}`,
					message: `Allocations (${(sum / 100).toFixed(2)}) must add up to the payment amount (${(amount / 100).toFixed(2)}).`
				});
			}
		}
		const targets = allocs.length > 0 ? allocs : [{ id: chargeId, cents: amount }];

		// Validate EVERY target before writing anything: same lease, published,
		// remaining-balance cap (no over-allocation), and a per-charge duplicate guard.
		const prepared: { charge: Charge; cents: number }[] = [];
		for (const t of targets) {
			let c: Charge;
			try {
				c = (await locals.pb.collection('charges').getOne(t.id)) as unknown as Charge;
			} catch {
				return fail(404, { section: `pay-${chargeId}`, message: 'A selected charge was not found.' });
			}
			if (c.lease !== charge.lease) {
				return fail(400, { section: `pay-${chargeId}`, message: 'Charges must belong to the same lease.' });
			}
			if (c.status !== 'published') {
				return fail(400, { section: `pay-${chargeId}`, message: `"${c.description}" is not published.` });
			}
			const paid = await locals.pb
				.collection('payments')
				.getFullList({ filter: `charge = "${t.id}"` })
				.then((r) => (r as unknown as Payment[]).reduce((s, p) => s + p.amount_cents, 0))
				.catch(() => 0);
			const remaining = c.amount_cents - paid;
			if (remaining <= 0) {
				return fail(400, { section: `pay-${chargeId}`, message: `"${c.description}" is already fully paid.` });
			}
			if (t.cents > remaining) {
				return fail(400, {
					section: `pay-${chargeId}`,
					message: `Allocation exceeds the remaining balance for "${c.description}" (${(remaining / 100).toFixed(2)}).`
				});
			}
			// Duplicate guard: identical allocation on the same charge within the same minute.
			// (PocketBase stores datetimes with a time component — compare by calendar day.)
			try {
				const candidates = (await locals.pb
					.collection('payments')
					.getFullList({
						filter: `charge = "${t.id}" && amount_cents = ${t.cents} && method = "${method}"`,
						sort: '-created'
					})) as unknown as Payment[];
				const dup = candidates.find(
					(p) => String(p.date).slice(0, 10) === date && Date.now() - new Date(p.created).getTime() < 60_000
				);
				if (dup) {
					return fail(400, {
						section: `pay-${chargeId}`,
						message: `That exact payment was just recorded for "${c.description}" — duplicate prevented.`
					});
				}
			} catch {
				// no duplicate
			}
			prepared.push({ charge: c, cents: t.cents });
		}

		try {
			for (const [i, p] of prepared.entries()) {
				await locals.pb.collection('payments').create({
					lease: charge.lease,
					charge: p.charge.id,
					amount_cents: p.cents,
					date,
					method,
					applies_to: p.charge.type === 'deposit' ? 'deposit' : 'rent',
					reference,
					note:
						prepared.length > 1
							? `${note ? note + ' · ' : ''}Split payment ${i + 1}/${prepared.length}`
							: note,
					recorded_by: user.id
				});
			}
		} catch (e) {
			return fail(500, { section: `pay-${chargeId}`, message: `Save failed: ${pbError(e)}` });
		}
		return {
			section: `pay-${chargeId}`,
			message:
				prepared.length > 1 ? `Payment recorded across ${prepared.length} charges.` : 'Payment recorded.'
		};
	},

	// Schedule every draft charge of a billing month for later publication.
	scheduleMonth: async ({ request, locals }) => {
		const form = await request.formData();
		const leaseId = String(form.get('lease') ?? '');
		const month = String(form.get('month') ?? '');
		const wall = String(form.get('publish_at') ?? ''); // LA wall time from datetime-local
		if (!leaseId || !/^\d{4}-\d{2}$/.test(month)) {
			return fail(400, { section: `sched-${month}`, message: 'Billing month is required.' });
		}
		if (!isWithinWindow(month, wall)) {
			return fail(400, {
				section: `sched-${month}`,
				message: `Pick a time between the 20th and the last day of the preceding month (${publishWindow(month).label}, Pacific).`
			});
		}
		const publishAt = laWallToUtcIso(wall);
		const drafts = (await locals.pb
			.collection('charges')
			.getFullList({ filter: `lease = "${leaseId}" && period = "${month}" && status = "draft"` })) as unknown as Charge[];
		if (drafts.length === 0) {
			return fail(400, { section: `sched-${month}`, message: 'No draft charges for that month.' });
		}
		const blockers = validateMonthPublicationBlockers(drafts);
		if (!blockers.ok) {
			return fail(400, { section: `sched-${month}`, message: blockers.message });
		}
		for (const d of drafts) {
			await locals.pb.collection('charges').update(d.id, { publish_at: publishAt });
		}
		return {
			section: `sched-${month}`,
			message: `Scheduled: ${drafts.length} charge(s) will publish on ${formatLaDateTime(publishAt)}.`
		};
	},

	// Publish every draft charge of a billing month immediately (idempotent).
	publishMonth: async ({ request, locals }) => {
		const form = await request.formData();
		const leaseId = String(form.get('lease') ?? '');
		const month = String(form.get('month') ?? '');
		if (!leaseId || !/^\d{4}-\d{2}$/.test(month)) {
			return fail(400, { section: `sched-${month}`, message: 'Billing month is required.' });
		}
		const drafts = (await locals.pb
			.collection('charges')
			.getFullList({ filter: `lease = "${leaseId}" && period = "${month}" && status = "draft"` })) as unknown as Charge[];
		if (drafts.length === 0) {
			return fail(400, { section: `sched-${month}`, message: 'No draft charges for that month.' });
		}
		const blockers = validateMonthPublicationBlockers(drafts);
		if (!blockers.ok) {
			return fail(400, { section: `sched-${month}`, message: blockers.message });
		}
		for (const d of drafts) {
			await locals.pb.collection('charges').update(d.id, { status: 'published', publish_at: '', preview_visible: false });
		}
		return {
			section: `sched-${month}`,
			message: `Published ${drafts.length} charge(s) — the bill is now visible to the tenant.`
		};
	},

	// Cancel a scheduled publication; the bill stays a draft indefinitely.
	cancelScheduleMonth: async ({ request, locals }) => {
		const form = await request.formData();
		const leaseId = String(form.get('lease') ?? '');
		const month = String(form.get('month') ?? '');
		if (!leaseId || !/^\d{4}-\d{2}$/.test(month)) {
			return fail(400, { section: `sched-${month}`, message: 'Billing month is required.' });
		}
		const drafts = (await locals.pb
			.collection('charges')
			.getFullList({ filter: `lease = "${leaseId}" && period = "${month}" && status = "draft"` })) as unknown as Charge[];
		for (const d of drafts) {
			await locals.pb.collection('charges').update(d.id, { publish_at: '' });
		}
		return {
			section: `sched-${month}`,
			message: 'Schedule canceled — the bill remains a draft until you publish it.'
		};
	}
};
