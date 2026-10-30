/**
 * End-to-end verification of the INDIVIDUAL-charge payment workflow, driven
 * through the running app's Admin UI form actions (login -> POST recordPayment
 * -> re-read), the same requests the browser makes. Grouped/split payments
 * (alloc-*) are intentionally out of scope.
 *
 * Scenario (all method "check", same reference CHK-1001):
 *   1. $1,000 toward $2,200 November rent  -> remaining $1,200, Partially Paid
 *   2. $1,200 toward November rent         -> Paid
 *   3. $1,000 security deposit             -> deposit received $1,000, $0 left
 *   4. $73.33 October partial rent, $70 credit-check fee
 * Then: reference reuse, double-submit guard, tenant rejection, empty-charge
 * rejection, and cross-view totals (admin vs tenant vs monthly statement).
 *
 * Runs ONLY against an isolated instance: the target guard refuses production.
 * Fixtures are throwaway rdtest-* records, fully removed at the end.
 * Requires the dev server running against the SAME isolated PocketBase, e.g.:
 *   PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090 npm run dev -- --port 5174
 *
 * Usage: node --env-file=.env.test --env-file=.env.test.local scripts/verify-charge-payments.mjs
 */
import PocketBase from 'pocketbase';
import { assertSafePocketBaseTarget } from './lib/pocketbase-target-guard.mjs';
import { summarizeLedger } from '../src/lib/server/billing.ts';
import { billStatus, groupChargesByMonth, depositCharges } from '../src/lib/billing.ts';

const PB = process.env.PUBLIC_POCKETBASE_URL;
const APP = process.env.APP_URL || 'http://localhost:5174';
const suEmail = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const suPassword = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!suEmail || !suPassword) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD.');
	process.exit(1);
}
assertSafePocketBaseTarget(PB);

const REF = 'CHK-1001'; // same check reference reused for every payment
const TODAY = new Date().toISOString().slice(0, 10);
const pw = `Rd!${Math.random().toString(36).slice(2)}pM3`;
const adminEmail = 'rdtest-pay-admin@example.com';
const tenantEmail = 'rdtest-pay-tenant@example.com';

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failed++;
};
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// --- app session helpers (mirror what the browser does) ----------------------
const cookieFrom = (res) => {
	const set = res.headers.getSetCookie?.() ?? [];
	const pbAuth = set.find((c) => c.startsWith('pb_auth='));
	return pbAuth ? pbAuth.split(';')[0] : '';
};

async function login(email, password) {
	const res = await fetch(`${APP}/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
		body: new URLSearchParams({ email, password }),
		redirect: 'manual'
	});
	return { status: res.status, cookie: cookieFrom(res) };
}

/** POST the admin billing page's recordPayment form action, as the UI does. */
async function recordPayment(cookie, fields) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const res = await fetch(`${APP}/dashboard/manage/billing?/recordPayment`, {
		method: 'POST',
		headers: { cookie, accept: 'text/html' },
		body: fd,
		redirect: 'manual'
	});
	return { status: res.status, body: await res.text() };
}

async function getPage(cookie, path) {
	const res = await fetch(`${APP}${path}`, { headers: { cookie }, redirect: 'manual' });
	return res.status;
}

// --- fixtures via superuser (used ONLY to create/remove test data) -----------
const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection('_superusers').authWithPassword(suEmail, suPassword);

let admin, tenant, lease;
const chargeIds = [];
try {
	admin = await su.collection('users').create({ email: adminEmail, password: pw, passwordConfirm: pw, name: 'Payments Test Admin', role: 'admin' });
	tenant = await su.collection('users').create({ email: tenantEmail, password: pw, passwordConfirm: pw, name: 'Payments Test Tenant', role: 'tenant' });
	lease = await su.collection('leases').create({
		tenant: tenant.id,
		start_date: '2026-10-30',
		end_date: '2027-10-29',
		monthly_rent_cents: 220000,
		deposit_cents: 100000,
		status: 'active'
	});
	const mkCharge = async (data) => {
		const c = await su.collection('charges').create({
			lease: lease.id,
			period: '',
			prorated: false,
			status: 'published',
			...data
		});
		chargeIds.push(c.id);
		return c;
	};
	const octRent = await mkCharge({ period: '2026-10', type: 'rent', description: 'Prorated rent — October 2026', amount_cents: 7333, due_date: '2026-10-30', prorated: true });
	const novRent = await mkCharge({ period: '2026-11', type: 'rent', description: 'Rent — November 2026', amount_cents: 220000, due_date: '2026-11-01' });
	const deposit = await mkCharge({ type: 'deposit', description: 'Security deposit', amount_cents: 100000, due_date: '2026-10-30' });
	const credit = await mkCharge({ type: 'other', description: 'Credit check fee', amount_cents: 7000, due_date: '2026-10-30' });

	const paymentsFor = (chargeId) => su.collection('payments').getFullList({ filter: `charge = "${chargeId}"`, sort: 'created' });
	const allPayments = () => su.collection('payments').getFullList({ filter: `lease = "${lease.id}"`, sort: 'created' });

	// --- log in through the real app -------------------------------------------
	const adminSession = await login(adminEmail, pw);
	check('admin login through app', adminSession.status === 303 && !!adminSession.cookie, `status ${adminSession.status}`);
	const tenantSession = await login(tenantEmail, pw);
	check('tenant login through app', tenantSession.status === 303 && !!tenantSession.cookie, `status ${tenantSession.status}`);

	// --- step 1: $1,000 toward November rent ------------------------------------
	let r = await recordPayment(adminSession.cookie, { charge: novRent.id, amount: '1000.00', date: TODAY, method: 'check', reference: REF, note: '' });
	check('1) $1,000 toward November rent accepted', r.status === 303 || r.status === 200, `status ${r.status}`);
	let ps = await paymentsFor(novRent.id);
	let p = ps[0];
	check('1) payment persisted with charge/lease/reference/recorded_by',
		ps.length === 1 && p.charge === novRent.id && p.lease === lease.id && p.reference === REF && p.recorded_by === admin.id && p.applies_to === 'rent' && p.method === 'check',
		ps.length ? `amount ${money(p.amount_cents)}, ref "${p.reference}"` : 'no payment found');
	const novPaid1 = ps.reduce((s, x) => s + x.amount_cents, 0);
	check('1) November rent Partially Paid with $1,200 remaining',
		billStatus(novRent, novPaid1) === 'partially_paid' && novRent.amount_cents - novPaid1 === 120000,
		`${money(novPaid1)} paid, ${money(novRent.amount_cents - novPaid1)} left`);

	// --- tenant must not record payments (attempt while $1,200 remains: every ---
	// --- validation passes for staff, so only the staff-only rule can stop it) --
	r = await recordPayment(tenantSession.cookie, { charge: novRent.id, amount: '50.00', date: TODAY, method: 'check', reference: REF, note: '' });
	ps = await paymentsFor(novRent.id);
	// A staff success returns 303; for a tenant the action either errors or its
	// fail() render is superseded by the page guard's redirect — either way the
	// staff-only payments createRule must prevent persistence.
	check('tenant cannot record payments (nothing persisted)',
		ps.length === 1 && !ps.some((x) => x.recorded_by === tenant.id),
		`response status ${r.status}, ${ps.length} payment(s) on November rent`);

	// --- step 2: remaining $1,200 ------------------------------------------------
	r = await recordPayment(adminSession.cookie, { charge: novRent.id, amount: '1200.00', date: TODAY, method: 'check', reference: REF, note: '' });
	ps = await paymentsFor(novRent.id);
	const novPaid2 = ps.reduce((s, x) => s + x.amount_cents, 0);
	check('2) final $1,200 accepted, November rent Paid',
		(r.status === 303 || r.status === 200) && novPaid2 === 220000 && billStatus(novRent, novPaid2) === 'paid',
		`${money(novPaid2)} of ${money(novRent.amount_cents)}`);

	// --- step 3: $1,000 deposit --------------------------------------------------
	r = await recordPayment(adminSession.cookie, { charge: deposit.id, amount: '1000.00', date: TODAY, method: 'check', reference: REF, note: '' });
	ps = await paymentsFor(deposit.id);
	p = ps[0];
	check('3) $1,000 deposit payment received, applies_to=deposit, $0 remaining',
		(r.status === 303 || r.status === 200) && ps.length === 1 && p.applies_to === 'deposit' && p.amount_cents === 100000,
		`deposit paid ${money(ps.reduce((s, x) => s + x.amount_cents, 0))}`);

	// --- step 4: October partial rent + credit-check fee -------------------------
	r = await recordPayment(adminSession.cookie, { charge: octRent.id, amount: '73.33', date: TODAY, method: 'check', reference: REF, note: '' });
	const octOk = (await paymentsFor(octRent.id))[0];
	check('4) $73.33 October partial rent recorded', (r.status === 303 || r.status === 200) && octOk?.amount_cents === 7333, `status ${r.status}`);

	r = await recordPayment(adminSession.cookie, { charge: credit.id, amount: '70.00', date: TODAY, method: 'check', reference: REF, note: '' });
	const creditOk = (await paymentsFor(credit.id))[0];
	check('4) $70 credit-check payment recorded', (r.status === 303 || r.status === 200) && creditOk?.amount_cents === 7000, `status ${r.status}`);

	// --- double-submit: identical $70 payment again, immediately -----------------
	r = await recordPayment(adminSession.cookie, { charge: credit.id, amount: '70.00', date: TODAY, method: 'check', reference: REF, note: '' });
	const creditPayments = await paymentsFor(credit.id);
	check('double-submit rejected by duplicate guard',
		r.status >= 400,
		`status ${r.status}${/duplicate prevented/i.test(r.body) ? ', message shown' : ''}`);
	check('double-submit created no second record', creditPayments.length === 1, `${creditPayments.length} record(s)`);

	// --- charge-less recording is impossible --------------------------------------
	const before = (await allPayments()).length;
	r = await recordPayment(adminSession.cookie, { charge: '', amount: '10.00', date: TODAY, method: 'check', reference: REF, note: '' });
	const after = (await allPayments()).length;
	check('empty charge relation rejected and nothing saved', r.status >= 400 && before === after, `status ${r.status}, ${before} -> ${after} payments`);

	// --- cross-view totals, read fresh (as each role's page does after reload) ---
	const all = await allPayments();
	check('exactly 5 payments recorded', all.length === 5, `${all.length}`);
	const totalPaid = all.reduce((s, x) => s + x.amount_cents, 0);
	check('total payments equal $3,343.33', totalPaid === 334333, money(totalPaid));
	check('same check reference reused across all allocations', all.every((x) => x.reference === REF), REF);
	check('every payment recorded_by the admin', all.every((x) => x.recorded_by === admin.id), '');
	check('no payment has an empty charge relation', all.every((x) => x.charge && x.charge !== ''), '');

	// Admin view: same loader + published filter the management page uses.
	const adminPb = new PocketBase(PB);
	adminPb.autoCancellation(false);
	await adminPb.collection('users').authWithPassword(adminEmail, pw);
	const adminCharges = (await adminPb.collection('charges').getFullList({ filter: `lease = "${lease.id}"`, sort: 'due_date,created' })).filter((c) => c.status === 'published');
	const adminPayments = await adminPb.collection('payments').getFullList({ filter: `lease = "${lease.id}"` });
	const adminLedger = summarizeLedger(adminCharges, adminPayments);
	check('admin totals: outstanding balance $0',
		adminLedger.rentBalance === 0 && adminLedger.depositBalance === 0 && adminLedger.totalBalance === 0,
		`rent ${money(adminLedger.rentBalance)}, deposit ${money(adminLedger.depositBalance)}`);

	// Tenant view: the tenant's OWN client (PocketBase rules limit visibility).
	const tenantPb = new PocketBase(PB);
	tenantPb.autoCancellation(false);
	await tenantPb.collection('users').authWithPassword(tenantEmail, pw);
	const tenantCharges = await tenantPb.collection('charges').getFullList({ filter: `lease = "${lease.id}"`, sort: 'due_date,created' });
	const tenantPayments = await tenantPb.collection('payments').getFullList({ filter: `lease = "${lease.id}"` });
	const tenantLedger = summarizeLedger(tenantCharges, tenantPayments);
	check('tenant sees the same 4 published charges and 5 payments',
		tenantCharges.length === 4 && tenantPayments.length === 5,
		`${tenantCharges.length} charges, ${tenantPayments.length} payments`);
	check('tenant totals agree with admin totals',
		tenantLedger.rentCharged === adminLedger.rentCharged && tenantLedger.rentPaid === adminLedger.rentPaid &&
		tenantLedger.depositCharged === adminLedger.depositCharged && tenantLedger.depositPaid === adminLedger.depositPaid &&
		tenantLedger.totalBalance === adminLedger.totalBalance,
		`tenant balance ${money(tenantLedger.totalBalance)}`);

	// Monthly statement view (same grouping the statement page uses).
	const statements = groupChargesByMonth(adminCharges, adminPayments);
	const oct = statements.find((s) => s.month === '2026-10');
	const nov = statements.find((s) => s.month === '2026-11');
	check('statement: October $73.33 charged/paid, $0 remaining',
		!!oct && oct.chargedCents === 7333 && oct.paidCents === 7333 && oct.remainingCents === 0,
		oct ? `${money(oct.chargedCents)}/${money(oct.paidCents)}` : 'missing month');
	check('statement: November $2,200 charged/paid, $0 remaining',
		!!nov && nov.chargedCents === 220000 && nov.paidCents === 220000 && nov.remainingCents === 0,
		nov ? `${money(nov.chargedCents)}/${money(nov.paidCents)}` : 'missing month');
	check('statement: deposit itemized separately at $1,000, fully paid',
		depositCharges(adminCharges).length === 1 && adminLedger.depositPaid === 100000 && adminLedger.depositBalance === 0,
		'');
	const stmtRemaining = statements.reduce((s, x) => s + x.remainingCents, 0);
	check('statement balances agree with ledger balance ($0 outstanding)',
		stmtRemaining === adminLedger.rentBalance + Math.max(0, adminLedger.depositBalance),
		`statements remaining ${money(stmtRemaining)}`);

	// Both dashboards render refreshed data without error.
	check('admin billing page loads (refresh)', (await getPage(adminSession.cookie, '/dashboard/manage/billing')) === 200, '');
	check('tenant dashboard loads (refresh)', (await getPage(tenantSession.cookie, '/dashboard/tenant')) === 200, '');
} finally {
	// Cleanup: lease deletion cascades to charges and payments; remove users too.
	if (lease) await su.collection('leases').delete(lease.id).catch(() => {});
	for (const id of chargeIds) await su.collection('charges').delete(id).catch(() => {});
	if (tenant) await su.collection('users').delete(tenant.id).catch(() => {});
	if (admin) await su.collection('users').delete(admin.id).catch(() => {});
	const strays = await su.collection('payments').getFullList({ filter: `lease = "${lease?.id}"` }).catch(() => []);
	for (const s of strays) await su.collection('payments').delete(s.id).catch(() => {});
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
