/**
 * Database-free unit tests for the billing calculations.
 *
 * Covers pure exported functions only — no PocketBase, no .env, no network:
 *  - $2,200 monthly rent across calendar months
 *  - $73.33 one-day proration (30-day month)
 *  - calendar-month boundaries (mid-month leases, leap years, splits)
 *  - partial and full payments
 *  - security-deposit separation from the rent ledger
 *  - draft-charge exclusion from tenant-facing figures
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	proratedRent,
	planLeaseCharges,
	summarizeLedger,
	daysInMonth,
	leaseMeetsMinimum
} from '../src/lib/server/billing.ts';
import {
	billStatus,
	groupChargesByMonth,
	depositCharges,
	computeRentCharge,
	splitByMonth,
	daysInclusive
} from '../src/lib/billing.ts';

const RENT = 220_000; // $2,200.00 per month, in cents

// Minimal record factories — only the fields the pure functions actually read.
const charge = (over = {}) => ({
	id: over.id ?? 'c1',
	type: 'rent',
	status: 'published',
	period: '2026-11',
	amount_cents: RENT,
	...over
});
const payment = (over = {}) => ({ id: over.id ?? 'p1', charge: '', amount_cents: 0, applies_to: 'rent', ...over });

// ---- $2,200 monthly rent ----------------------------------------------------

test('full calendar months bill the full $2,200 rent', () => {
	const plan = planLeaseCharges({
		start_date: '2026-11-01',
		end_date: '2027-01-31',
		monthly_rent_cents: RENT,
		deposit_cents: 0
	});
	assert.equal(plan.length, 3);
	assert.deepEqual(
		plan.map((c) => c.period),
		['2026-11', '2026-12', '2027-01']
	);
	for (const c of plan) {
		assert.equal(c.type, 'rent');
		assert.equal(c.amount_cents, RENT);
		assert.equal(c.prorated, false);
		assert.match(c.description, /^Rent — /);
	}
	assert.deepEqual(
		plan.map((c) => c.due_date),
		['2026-11-01', '2026-12-01', '2027-01-01']
	);
});

// ---- $73.33 one-day proration ----------------------------------------------

test('a single occupied day in a 30-day month prorates to $73.33', () => {
	// November 2026 has 30 days: 220000 * 1/30 = 7333.33 -> 7333 cents.
	const cents = proratedRent(RENT, new Date(2026, 10, 30), new Date(2026, 10, 30));
	assert.equal(cents, 7333); // $73.33

	const plan = planLeaseCharges({
		start_date: '2026-11-30',
		end_date: '2026-11-30',
		monthly_rent_cents: RENT,
		deposit_cents: 0
	});
	assert.equal(plan.length, 1);
	assert.equal(plan[0].amount_cents, 7333);
	assert.equal(plan[0].prorated, true);
	assert.equal(plan[0].due_date, '2026-11-30');
});

// ---- calendar-month boundaries ----------------------------------------------

test('daysInMonth respects calendar boundaries including leap years', () => {
	assert.equal(daysInMonth(2026, 10), 30); // November
	assert.equal(daysInMonth(2026, 11), 31); // December
	assert.equal(daysInMonth(2024, 1), 29); // February, leap year
	assert.equal(daysInMonth(2027, 1), 28); // February, common year
});

test('mid-month lease prorates the first and last month only', () => {
	const plan = planLeaseCharges({
		start_date: '2026-11-15',
		end_date: '2027-02-14',
		monthly_rent_cents: RENT,
		deposit_cents: 0
	});
	assert.deepEqual(
		plan.map((c) => [c.period, c.amount_cents, c.prorated]),
		[
			['2026-11', Math.round((RENT * 16) / 30), true], // Nov 15-30 = 16 of 30 days -> $1,173.33
			['2026-12', RENT, false],
			['2027-01', RENT, false],
			['2027-02', Math.round((RENT * 14) / 28), true] // Feb 1-14 = 14 of 28 days -> $1,100.00
		]
	);
	assert.equal(plan[0].due_date, '2026-11-15'); // due on the first occupied day
	assert.equal(plan[3].amount_cents, 110_000); // exact $1,100.00
});

test('rent computation splits a range at the calendar-month boundary', () => {
	assert.equal(daysInclusive('2026-11-28', '2026-12-02'), 5);
	assert.deepEqual(splitByMonth('2026-11-28', '2026-12-02'), [
		{ month: '2026-11', days: 3, days_in_month: 30 },
		{ month: '2026-12', days: 2, days_in_month: 31 }
	]);

	const result = computeRentCharge({
		monthlyRentCents: RENT,
		basis: 'actual',
		mode: 'range',
		start: '2026-11-28',
		end: '2026-12-02'
	});
	assert.ok(!('error' in result));
	assert.equal(result.billable_days, 5);
	// Each portion uses its own month's real daily rate.
	assert.equal(result.amount_cents, Math.round((RENT * 3) / 30 + (RENT * 2) / 31));
});

test('30-day basis charges one day of $2,200 rent as $73.33 regardless of month', () => {
	const result = computeRentCharge({ monthlyRentCents: RENT, basis: '30-day', mode: 'days', days: 1 });
	assert.ok(!('error' in result));
	assert.equal(result.amount_cents, 7333); // $73.33
});

// ---- partial and full payments ----------------------------------------------

test('ledger reflects partial then full payment of a rent charge', () => {
	const charges = [charge({ amount_cents: RENT })];

	const partial = summarizeLedger(charges, [payment({ amount_cents: 100_000 })]);
	assert.equal(partial.rentCharged, RENT);
	assert.equal(partial.rentPaid, 100_000);
	assert.equal(partial.rentBalance, 120_000);
	assert.equal(partial.totalBalance, 120_000);

	const full = summarizeLedger(charges, [
		payment({ id: 'p1', amount_cents: 100_000 }),
		payment({ id: 'p2', amount_cents: 120_000 })
	]);
	assert.equal(full.rentPaid, RENT);
	assert.equal(full.rentBalance, 0);
	assert.equal(full.totalBalance, 0);
});

test('per-charge status moves unpaid -> partially_paid -> paid', () => {
	const c = charge({ amount_cents: RENT });
	assert.equal(billStatus(c, 0), 'unpaid');
	assert.equal(billStatus(c, 100_000), 'partially_paid');
	assert.equal(billStatus(c, RENT), 'paid');
	assert.equal(billStatus(c, RENT + 50_000), 'paid'); // overpayment still reads as paid
});

test('monthly statements allocate payments to their billed charge', () => {
	const charges = [charge({ id: 'c1', period: '2026-11', amount_cents: RENT })];
	const payments = [
		payment({ id: 'p1', charge: 'c1', amount_cents: 100_000 }),
		payment({ id: 'p2', charge: '', amount_cents: 50_000 }) // unallocated: not on this statement
	];
	const [stmt] = groupChargesByMonth(charges, payments);
	assert.equal(stmt.month, '2026-11');
	assert.equal(stmt.label, 'November 2026');
	assert.equal(stmt.chargedCents, RENT);
	assert.equal(stmt.paidCents, 100_000);
	assert.equal(stmt.remainingCents, 120_000);
	assert.deepEqual(
		stmt.payments.map((p) => p.id),
		['p1']
	);
});

// ---- deposit separation ------------------------------------------------------

test('security deposit stays out of the rent ledger', () => {
	const charges = [charge({ id: 'c1', amount_cents: RENT }), charge({ id: 'c2', type: 'deposit', period: '', amount_cents: RENT })];
	const payments = [
		payment({ id: 'p1', amount_cents: RENT, applies_to: 'deposit' }), // deposit paid in full
		payment({ id: 'p2', amount_cents: 50_000, applies_to: 'rent' })
	];
	const l = summarizeLedger(charges, payments);
	assert.equal(l.rentCharged, RENT);
	assert.equal(l.rentPaid, 50_000);
	assert.equal(l.rentBalance, 170_000);
	assert.equal(l.depositCharged, RENT);
	assert.equal(l.depositPaid, RENT);
	assert.equal(l.depositBalance, 0);
	assert.equal(l.totalBalance, 170_000); // rent balance only; deposit is settled
});

test('deposit charges are itemized separately, never in monthly statements', () => {
	const charges = [
		charge({ id: 'c1', period: '2026-11', amount_cents: RENT }),
		charge({ id: 'c2', type: 'deposit', period: '', amount_cents: RENT })
	];
	const statements = groupChargesByMonth(charges, []);
	assert.equal(statements.length, 1);
	assert.equal(statements[0].charges.length, 1);
	assert.equal(statements[0].charges[0].type, 'rent');

	const deposits = depositCharges(charges);
	assert.deepEqual(
		deposits.map((c) => c.id),
		['c2']
	);
});

test('a planned deposit is a separate charge due on the start date', () => {
	const plan = planLeaseCharges({
		start_date: '2026-11-01',
		end_date: '2026-11-30',
		monthly_rent_cents: RENT,
		deposit_cents: RENT
	});
	assert.equal(plan.length, 2);
	assert.equal(plan[0].type, 'deposit');
	assert.equal(plan[0].amount_cents, RENT);
	assert.equal(plan[0].period, '');
	assert.equal(plan[0].due_date, '2026-11-01');
	assert.equal(plan[1].type, 'rent');
});

// ---- draft exclusion ---------------------------------------------------------

test('draft charges never appear in tenant-facing monthly statements', () => {
	const charges = [
		charge({ id: 'c1', period: '2026-11', amount_cents: RENT }),
		charge({ id: 'c2', period: '2026-12', amount_cents: RENT, status: 'draft' })
	];
	const statements = groupChargesByMonth(charges, []);
	assert.deepEqual(
		statements.map((s) => s.month),
		['2026-11']
	);
	assert.equal(statements[0].chargedCents, RENT); // the $2,200 draft is excluded
});

test('draft deposits are excluded from the itemized deposit list', () => {
	const charges = [
		charge({ id: 'c1', type: 'deposit', period: '', status: 'published' }),
		charge({ id: 'c2', type: 'deposit', period: '', status: 'draft' })
	];
	assert.deepEqual(
		depositCharges(charges).map((c) => c.id),
		['c1']
	);
});

test('a draft bill reports draft status even against payments', () => {
	assert.equal(billStatus(charge({ status: 'draft' }), RENT), 'draft');
});

// ---- adjacent invariant ------------------------------------------------------

test('three-month minimum allows ending one day before the anniversary', () => {
	assert.equal(leaseMeetsMinimum('2026-11-15', '2027-02-14', 3), true);
	assert.equal(leaseMeetsMinimum('2026-11-15', '2027-02-13', 3), false);
});
