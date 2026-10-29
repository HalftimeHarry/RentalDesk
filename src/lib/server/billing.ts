import type { Charge, ChargeType, Lease, Payment } from '$lib/types';
import type { Ledger } from '$lib/types';

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
