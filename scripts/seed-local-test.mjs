/**
 * RentalDesk — LOCAL-ONLY manual-test seed.
 *
 * Seeds a realistic but fictional dataset into the isolated local PocketBase:
 *   Accounts (shared password — see "Password" below; all @example.test):
 *     owner@example.test     Owner    — full management access
 *     admin@example.test     Admin    — management access
 *     applicant@example.test Applicant — has a submitted application
 *     tenant@example.test    Tenant   — active lease with sample charges
 *   invitee@example.test is deliberately NEVER created — reserved for testing
 *   new-user invitations.
 *
 *   Records: the unit listing (settings, created only when absent), one active
 *   lease for the tenant, PUBLISHED charges (current-month rent, AT&T utility
 *   reimbursement, security deposit), one DRAFT bill (next month's rent), and
 *   one DRAFT move-in inspection.
 *
 * Idempotent: every record is found-or-created by a unique natural key, so
 * reruns change nothing. Nothing is ever deleted — unrelated records (and the
 * disposable rdtest-*@example.com automated-test fixtures) are left alone.
 * Seeded data is identifiable by the @example.test accounts and the record
 * summary printed at the end. No emails or invitations are sent.
 *
 * The target guard refuses production and any non-local destination.
 *
 * Password: read TEST_ACCOUNTS_PASSWORD from the git-ignored .env.test.local
 * (open that file privately; it is never printed here).
 *
 * Usage: node --env-file=.env.test --env-file=.env.test.local scripts/seed-local-test.mjs
 */
import PocketBase from 'pocketbase';
import { assertSafePocketBaseTarget } from './lib/pocketbase-target-guard.mjs';

const PB = process.env.PUBLIC_POCKETBASE_URL;
assertSafePocketBaseTarget(PB);

const suEmail = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const suPassword = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
const testPassword = process.env.TEST_ACCOUNTS_PASSWORD;
if (!suEmail || !suPassword || !testPassword) {
	console.error('Missing env: need PRIVATE_POCKETBASE_SUPERUSER_* and TEST_ACCOUNTS_PASSWORD (see .env.test.local).');
	process.exit(1);
}

const pb = new PocketBase(PB);
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(suEmail, suPassword);

const summary = [];
function report(kind, label, created) {
	summary.push({ kind, label, created });
	console.log(`${created ? 'created ' : 'exists  '}  ${kind}: ${label}`);
}

async function findOrCreateUser(email, name, role) {
	const existing = await pb
		.collection('users')
		.getFirstListItem(`email = "${email}"`)
		.catch(() => null);
	if (existing) {
		report('user', `${email} (${role})`, false);
		return existing;
	}
	const created = await pb.collection('users').create({
		email,
		password: testPassword,
		passwordConfirm: testPassword,
		name,
		role
	});
	report('user', `${email} (${role})`, true);
	return created;
}

const owner = await findOrCreateUser('owner@example.test', 'Test Owner', 'owner');
const admin = await findOrCreateUser('admin@example.test', 'Test Admin', 'admin');
const applicant = await findOrCreateUser('applicant@example.test', 'Test Applicant', 'applicant');
const tenant = await findOrCreateUser('tenant@example.test', 'Test Tenant', 'tenant');
void owner; void admin;

// --- sample rental listing (settings singleton; never overwritten) -------------
const existingSettings = await pb.collection('settings').getList(1, 1, { sort: 'created' }).catch(() => null);
if (existingSettings && existingSettings.totalItems > 0) {
	report('settings', 'unit listing (left untouched)', false);
} else {
	await pb.collection('settings').create({
		unit_name: 'Rental Unit',
		description: 'A clean, well-maintained unit ready for move-in.',
		address: '2728 B Street, San Diego, CA 92102',
		monthly_rent_cents: 225000,
		deposit_cents: 50000,
		min_lease_months: 3,
		is_available: true,
		screening_fee_cents: 3500
	});
	report('settings', 'unit listing', true);
}

// --- applicant: a submitted application ----------------------------------------
const existingApp = await pb
	.collection('applications')
	.getFirstListItem(`applicant = "${applicant.id}"`)
	.catch(() => null);
if (existingApp) {
	report('application', `applicant submission (${existingApp.status})`, false);
} else {
	await pb.collection('applications').create({
		applicant: applicant.id,
		status: 'submitted',
		full_name: 'Test Applicant',
		phone: '555-0100',
		current_address: '100 Sample Ave, San Diego, CA',
		employer: 'Example Corp',
		monthly_income_cents: 650000,
		move_in_date: '2026-12-01',
		notes: 'Seeded sample application for manual testing.',
		submitted: new Date().toISOString(),
		screening_fee_cents: 3500
	});
	report('application', 'applicant submission (submitted)', true);
}

// --- tenant lease ---------------------------------------------------------------
let lease = await pb
	.collection('leases')
	.getFirstListItem(`tenant = "${tenant.id}" && status = "active"`)
	.catch(() => null);
if (lease) {
	report('lease', `tenant lease ${lease.id} (${lease.start_date} → ${lease.end_date})`, false);
} else {
	lease = await pb.collection('leases').create({
		tenant: tenant.id,
		start_date: '2026-10-01',
		end_date: '2027-09-30',
		monthly_rent_cents: 220000,
		deposit_cents: 100000,
		status: 'active'
	});
	report('lease', `tenant lease ${lease.id} (2026-10-01 → 2027-09-30, $2,200/mo, $1,000 deposit)`, true);
}

// --- charges: find-or-create by (lease, type, period, description) --------------
async function findOrCreateCharge(data) {
	const key = `lease = "${lease.id}" && type = "${data.type}" && period = "${data.period ?? ''}" && description = "${data.description}"`;
	const existing = await pb.collection('charges').getFirstListItem(key).catch(() => null);
	if (existing) {
		report('charge', `${data.description} [${data.status}]`, false);
		return existing;
	}
	const created = await pb.collection('charges').create(data);
	report('charge', `${data.description} [${data.status}] $${(data.amount_cents / 100).toFixed(2)}`, true);
	return created;
}

await findOrCreateCharge({
	lease: lease.id, period: '2026-11', type: 'rent', description: 'Rent — November 2026',
	amount_cents: 220000, due_date: '2026-11-01', prorated: false, status: 'published',
	period_start: '', period_end: ''
});
await findOrCreateCharge({
	lease: lease.id, period: '2026-11', type: 'other', description: 'AT&T reimbursement — November 2026',
	amount_cents: 6500, due_date: '2026-11-01', prorated: false, status: 'published',
	period_start: '', period_end: ''
});
await findOrCreateCharge({
	lease: lease.id, period: '', type: 'deposit', description: 'Security deposit',
	amount_cents: 100000, due_date: '2026-10-01', prorated: false, status: 'published',
	period_start: '', period_end: ''
});
await findOrCreateCharge({
	lease: lease.id, period: '2026-12', type: 'rent', description: 'Rent — December 2026 (seed draft)',
	amount_cents: 220000, due_date: '2026-12-01', prorated: false, status: 'draft',
	period_start: '', period_end: ''
});

// --- draft move-in inspection -----------------------------------------------------
const existingInsp = await pb
	.collection('inspections')
	.getFirstListItem(`lease = "${lease.id}" && type = "move_in" && stage = "draft"`)
	.catch(() => null);
if (existingInsp) {
	report('inspection', `move-in draft ${existingInsp.id}`, false);
} else {
	await pb.collection('inspections').create({
		lease: lease.id,
		date: new Date().toISOString().slice(0, 10),
		type: 'move_in',
		notes: 'Seeded sample inspection for manual testing.',
		tenant_names: 'Test Tenant',
		occupancy: 'occupied',
		move_in_date: '2026-10-01',
		stage: 'draft'
	});
	report('inspection', 'move-in draft', true);
}

console.log(`\nSeed complete: ${summary.filter((s) => s.created).length} created, ${summary.filter((s) => !s.created).length} already present.`);
console.log('Accounts: owner@ / admin@ / applicant@ / tenant@ — all @example.test (password in .env.test.local, not shown).');
console.log('invitee@example.test intentionally left uncreated for invitation testing.');
