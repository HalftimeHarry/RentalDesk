import type { Charge, ChargeType, Lease, Payment } from '$lib/types';
import type { Ledger } from '$lib/types';
import type PocketBase from 'pocketbase';

export interface TenantPreviewCharge {
	id: string;
	lease: string;
	period: string;
	type: ChargeType;
	description: string;
	due_date: string;
	amount_cents?: number;
	amount_pending: boolean;
	publish_at: string;
	preview_visible: boolean;
}

export function isTenantFacingDescription(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	const lowered = trimmed.toLowerCase();
	return !/(internal|private|staff|admin|note|notes)/i.test(lowered);
}

export function sanitizeTenantPreviewCharge(charge: Partial<Charge> | null | undefined): TenantPreviewCharge | null {
	if (!charge || charge.status !== 'draft' || charge.preview_visible !== true) return null;
	const description = typeof charge.description === 'string' ? charge.description.trim() : '';
	if (!description || !isTenantFacingDescription(description)) return null;
	const amountPending = !!charge.amount_pending;
	const preview: TenantPreviewCharge = {
		id: String(charge.id ?? ''),
		lease: String(charge.lease ?? ''),
		period: charge.period ?? '',
		type: (charge.type ?? 'other') as ChargeType,
		description,
		due_date: charge.due_date ?? '',
		amount_pending: amountPending,
		publish_at: charge.publish_at ?? '',
		preview_visible: true
	};
	if (!amountPending && typeof charge.amount_cents === 'number') {
		preview.amount_cents = charge.amount_cents;
	}
	return preview;
}

export function filterTenantPreviewCharges(charges: Charge[], leaseId: string): TenantPreviewCharge[] {
	return charges
		.filter((c) => c.lease === leaseId && c.status === 'draft' && c.preview_visible === true)
		.map((c) => sanitizeTenantPreviewCharge(c))
		.filter((c): c is TenantPreviewCharge => !!c);
}

export function gatherPendingPublicationBlockers(charges: Charge[]): string[] {
	return charges
		.filter((c) => c.status === 'draft' && c.amount_pending)
		.map((c) => c.description || 'Unnamed draft charge');
}

export function validatePublicationReadiness(charge: Charge): { ok: true } | { ok: false; message: string } {
	if (charge.status !== 'draft') {
		return { ok: false, message: 'Only draft charges can be published.' };
	}
	if (charge.amount_pending) {
		return {
			ok: false,
			message: `"${charge.description || 'This charge'}" has an unknown amount and cannot be published.`
		};
	}
	return { ok: true };
}

/**
 * Shared charge loading for a lease — used by BOTH the management billing page
 * and the tenant dashboard so both views read identical records in identical
 * order. PocketBase rules still decide what each role may see (tenants only
 * get published charges back).
 * Errors are returned, never swallowed, so callers can surface them.
 */
export async function getLeaseCharges(
	pb: PocketBase,
	leaseId: string
): Promise<{ charges: Charge[]; error: string | null }> {
	try {
		const charges = (await pb
			.collection('charges')
			.getFullList({ filter: `lease = "${leaseId}"`, sort: 'due_date,created' })) as unknown as Charge[];
		return { charges, error: null };
	} catch (e) {
		const err = e as { response?: { message?: string }; message?: string };
		return { charges: [], error: err?.response?.message || err?.message || 'unknown error' };
	}
}

/**
 * Calendar-month billing.
 *
 * Rent is charged per calendar month. A lease that starts (or ends) part-way
 * through a month is prorated by actual days: days occupied in the month
 * divided by days in that month. The security deposit is a separate charge
 * type and is never mixed into the rent ledger.
 */

export interface PlannedCharge {
	period: string; // YYYY-MM or ''
	type: ChargeType;
	description: string;
	amount_cents: number;
	due_date: string; // YYYY-MM-DD
	prorated: boolean;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

export function toISODate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysInMonth(year: number, monthIndex: number): number {
	return new Date(year, monthIndex + 1, 0).getDate();
}

function parseISODate(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d);
}

/** Prorated rent for the occupied slice [from, to] (inclusive) of one calendar month. */
export function proratedRent(monthlyRentCents: number, from: Date, to: Date): number {
	const dim = daysInMonth(from.getFullYear(), from.getMonth());
	const days = to.getDate() - from.getDate() + 1;
	return Math.round((monthlyRentCents * days) / dim);
}

function monthLabel(d: Date): string {
	return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Build the full charge schedule for a lease:
 *  - one deposit charge due on the start date
 *  - rent charges for every calendar month touched by [start_date, end_date],
 *    prorating the first and last month when they are partial
 */
export function planLeaseCharges(lease: {
	start_date: string;
	end_date: string;
	monthly_rent_cents: number;
	deposit_cents: number;
}): PlannedCharge[] {
	const start = parseISODate(lease.start_date);
	const end = parseISODate(lease.end_date);
	const charges: PlannedCharge[] = [];

	if (lease.deposit_cents > 0) {
		charges.push({
			period: '',
			type: 'deposit',
			description: 'Security deposit',
			amount_cents: lease.deposit_cents,
			due_date: lease.start_date,
			prorated: false
		});
	}

	const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
	while (cursor <= end) {
		const y = cursor.getFullYear();
		const m = cursor.getMonth();
		const monthStart = new Date(y, m, 1);
		const monthEnd = new Date(y, m, daysInMonth(y, m));

		const from = start > monthStart ? start : monthStart;
		const to = end < monthEnd ? end : monthEnd;
		const fullMonth = from.getTime() === monthStart.getTime() && to.getTime() === monthEnd.getTime();
		const period = `${y}-${pad(m + 1)}`;

		charges.push({
			period,
			type: 'rent',
			description: fullMonth ? `Rent — ${monthLabel(cursor)}` : `Prorated rent — ${monthLabel(cursor)}`,
			amount_cents: fullMonth ? lease.monthly_rent_cents : proratedRent(lease.monthly_rent_cents, from, to),
			due_date: toISODate(from),
			prorated: !fullMonth
		});

		cursor.setFullYear(y, m + 1, 1);
	}

	return charges;
}

/** Minimum lease length check (three-month minimum by default). */
export function leaseMeetsMinimum(startISO: string, endISO: string, minMonths: number): boolean {
	const start = parseISODate(startISO);
	const earliest = new Date(start.getFullYear(), start.getMonth() + minMonths, start.getDate());
	// Allow ending one day before the N-month anniversary (e.g. Jan 15 – Apr 14 is three months).
	earliest.setDate(earliest.getDate() - 1);
	return parseISODate(endISO) >= earliest;
}

/** Summarize a lease ledger, keeping the security deposit separate from rent. */
export function summarizeLedger(charges: Charge[], payments: Payment[]): Ledger {
	let rentCharged = 0;
	let depositCharged = 0;
	for (const c of charges) {
		if (c.type === 'deposit') depositCharged += c.amount_cents;
		else rentCharged += c.amount_cents;
	}
	let rentPaid = 0;
	let depositPaid = 0;
	for (const p of payments) {
		if (p.applies_to === 'deposit') depositPaid += p.amount_cents;
		else rentPaid += p.amount_cents;
	}
	const rentBalance = rentCharged - rentPaid;
	const depositBalance = depositCharged - depositPaid;
	return {
		rentCharged,
		rentPaid,
		rentBalance,
		depositCharged,
		depositPaid,
		depositBalance,
		totalBalance: rentBalance + depositBalance
	};
}

export type { Lease, Payment };
