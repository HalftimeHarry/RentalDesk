/**
 * Rent charge calculations for the billing composer.
 * Universal module (client preview + authoritative server calculation).
 * Amounts stay in integer cents; math runs at full precision and only the
 * final charge is rounded to cents.
 */

export interface RentPortion {
	month: string; // YYYY-MM
	days: number;
	days_in_month: number;
	amount_cents_exact: number; // unrounded, for display of the split
}

export interface RentComputation {
	amount_cents: number;
	monthly_rate_cents: number; // the rent the calculation started from
	billable_days: number;
	daily_rate_cents: number; // for 30-day basis; for actual basis, the current calendar month rate
	portions: RentPortion[];
	period_start: string; // YYYY-MM-DD
	period_end: string;
	basis: '30-day' | 'actual';
	/** Present when management authorized a manual amount override. */
	override?: { amount_cents: number; reason: string };
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

export function daysInMonth(year: number, monthIndex: number): number {
	return new Date(year, monthIndex + 1, 0).getDate();
}

/** Inclusive day count between two YYYY-MM-DD dates (both endpoints count). */
export function daysInclusive(start: string, end: string): number {
	const a = new Date(`${start}T00:00:00`);
	const b = new Date(`${end}T00:00:00`);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
	return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function monthLabel(y: number, m: number): string {
	return `${y}-${pad(m + 1)}`;
}

/** Split an inclusive date range into per-calendar-month portions. */
export function splitByMonth(start: string, end: string): { month: string; days: number; days_in_month: number }[] {
	const a = new Date(`${start}T00:00:00`);
	const b = new Date(`${end}T00:00:00`);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return [];
	const out: { month: string; days: number; days_in_month: number }[] = [];
	const cursor = new Date(a);
	while (cursor <= b) {
		const y = cursor.getFullYear();
		const m = cursor.getMonth();
		const dim = daysInMonth(y, m);
		const monthStart = new Date(y, m, 1);
		const monthEnd = new Date(y, m, dim);
		const from = cursor > monthStart ? cursor : monthStart;
		const to = b < monthEnd ? b : monthEnd;
		const days = to.getDate() - from.getDate() + 1;
		out.push({ month: monthLabel(y, m), days, days_in_month: dim });
		cursor.setFullYear(y, m + 1, 1);
	}
	return out;
}

export function computeRentCharge(opts: {
	monthlyRentCents: number;
	basis: '30-day' | 'actual';
	mode: 'days' | 'range';
	days?: number;
	start?: string;
	end?: string;
}): RentComputation | { error: string } {
	const { monthlyRentCents, basis, mode } = opts;
	if (!Number.isInteger(monthlyRentCents) || monthlyRentCents <= 0) {
		return { error: 'Monthly rent must be a positive amount.' };
	}

	let billableDays = 0;
	let periodStart = opts.start ?? '';
	let periodEnd = opts.end ?? '';

	if (mode === 'days') {
		billableDays = Math.trunc(opts.days ?? 0);
		if (billableDays < 1 || billableDays > 366) {
			return { error: 'Enter the number of billable days (at least 1).' };
		}
		// period dates optional in days mode; when present they describe the span
		if (periodStart && !periodEnd) periodEnd = periodStart;
	} else {
		if (!opts.start || !opts.end) return { error: 'Select both a start and an end date.' };
		billableDays = daysInclusive(opts.start, opts.end);
		if (billableDays < 1) return { error: 'End date must be on or after the start date.' };
	}

	if (basis === '30-day') {
		// Contractual 30-day month: one flat daily rate regardless of calendar month.
		const daily = monthlyRentCents / 30;
		const exact = daily * billableDays;
		return {
			amount_cents: Math.round(exact),
			monthly_rate_cents: monthlyRentCents,
			billable_days: billableDays,
			daily_rate_cents: daily,
			portions: [
				{ month: periodStart.slice(0, 7) || 'partial', days: billableDays, days_in_month: 30, amount_cents_exact: exact }
			],
			period_start: periodStart,
			period_end: periodEnd,
			basis
		};
	}

	// Actual calendar days: split the range into monthly portions and charge
	// each portion at that month's real daily rate.
	const splits = splitByMonth(opts.start!, opts.end!);
	if (splits.length === 0) return { error: 'Invalid date range.' };
	let exactTotal = 0;
	const portions: RentPortion[] = splits.map((s) => {
		const exact = (monthlyRentCents * s.days) / s.days_in_month;
		exactTotal += exact;
		return { ...s, amount_cents_exact: exact };
	});
	const [y, m] = opts.start!.split('-').map(Number);
	return {
		amount_cents: Math.round(exactTotal),
		monthly_rate_cents: monthlyRentCents,
		billable_days: billableDays,
		daily_rate_cents: monthlyRentCents / daysInMonth(y, m - 1),
		portions,
		period_start: periodStart,
		period_end: periodEnd,
		basis
	};
}

/** Per-charge payment status derived from allocated payments. */
export type BillStatus = 'draft' | 'unpaid' | 'partially_paid' | 'paid';

export function billStatus(charge: { status?: string; amount_cents: number }, paidCents: number): BillStatus {
	if (charge.status === 'draft') return 'draft';
	if (paidCents <= 0) return 'unpaid';
	if (paidCents < charge.amount_cents) return 'partially_paid';
	return 'paid';
}
