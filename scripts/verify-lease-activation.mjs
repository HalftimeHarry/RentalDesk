/**
 * End-to-end verification of the lease-activation workflow and the configurable
 * credit-check (screening) fee, through the running app's form actions.
 *
 * Lease activation:
 *   createLease -> PENDING lease only (no role change, no charges, no delist)
 *   activate without signed packet -> rejected
 *   upload signed lease PDF -> activate -> active lease, Tenant role, DRAFT
 *   charges, delisted unit; retry -> no duplicate charges or transitions.
 *
 * Screening fee:
 *   fee + instructions shown pre-submission; amount snapshot stored at submit;
 *   applicant reference = "payment reported" (never "paid"); applicant cannot
 *   self-confirm (API rule); staff confirms; price change affects only new
 *   submissions.
 *
 * Runs ONLY against an isolated instance (guard refuses production). Throwaway
 * rdtest-* fixtures are removed at the end. Requires the dev server bound to
 * the SAME isolated PocketBase.
 *
 * Usage: node --env-file=.env.test --env-file=.env.test.local scripts/verify-lease-activation.mjs
 */
import PocketBase from 'pocketbase';
import { assertSafePocketBaseTarget } from './lib/pocketbase-target-guard.mjs';

const PB = process.env.PUBLIC_POCKETBASE_URL;
const APP = process.env.APP_URL || 'http://localhost:5174';
const suEmail = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const suPassword = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!suEmail || !suPassword) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD.');
	process.exit(1);
}
assertSafePocketBaseTarget(PB);

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failed++;
};

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
async function post(cookie, path, action, fields) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const res = await fetch(`${APP}${path}?/${action}`, {
		method: 'POST',
		headers: { cookie, accept: 'text/html' },
		body: fd,
		redirect: 'manual'
	});
	return { status: res.status, body: await res.text() };
}

const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection('_superusers').authWithPassword(suEmail, suPassword);

// Shared instance state: reset settings to the baseline so reruns are repeatable.
// (The last step intentionally changes the fee and delists the unit.)
async function resetSettings() {
	const list = await su.collection('settings').getList(1, 1, { sort: 'created' });
	if (list.items.length > 0) {
		await su.collection('settings').update(list.items[0].id, { screening_fee_cents: 3500, is_available: true });
	}
}
await resetSettings();

const pw = `Rd!${Math.random().toString(36).slice(2)}aC7`;
let admin, applicant, leaseId = null;
const png64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

try {
	admin = await su.collection('users').create({ email: 'rdtest-act-admin@example.com', password: pw, passwordConfirm: pw, name: 'Activation Admin', role: 'admin' });
	applicant = await su.collection('users').create({ email: 'rdtest-act-app@example.com', password: pw, passwordConfirm: pw, name: 'Activation Applicant', role: 'applicant' });

	const adminS = await login('rdtest-act-admin@example.com', pw);
	const appS = await login('rdtest-act-app@example.com', pw);
	check('admin + applicant logins', adminS.status === 303 && appS.status === 303, '');

	// ---- screening fee: draft, submit with reference, snapshot ------------------
	let r = await post(appS.cookie, '/dashboard/applicant', 'saveApplication', {
		full_name: 'Activation Applicant', phone: '555-0100', current_address: '1 Test Way',
		employer: 'Test Co', monthly_income: '5000', move_in_date: '2026-11-01', notes: ''
	});
	check('application draft saved', r.status === 303 || r.status === 200, '');

	const preFeeSettings = await su.collection('settings').getList(1, 1, { sort: 'created' });
	check('settings fee at $35.00 baseline', preFeeSettings.items[0]?.screening_fee_cents === 3500, `stored: ${preFeeSettings.items[0]?.screening_fee_cents}`);

	r = await post(appS.cookie, '/dashboard/applicant', 'submitApplication', { screening_payment_ref: 'ZELLE-TEST-1' });
	const app1 = await su.collection('applications').getFirstListItem(`applicant = "${applicant.id}"`);
	check('submission stores fee snapshot $35.00 + reference', app1.screening_fee_cents === 3500 && app1.screening_payment_ref === 'ZELLE-TEST-1', `fee=${app1.screening_fee_cents} ref=${app1.screening_payment_ref}`);
	check('fee not confirmed at submission', app1.screening_fee_confirmed === false, '');

	// applicant cannot self-confirm via the API (rule blocks the field)
	const appClient = new PocketBase(PB);
	await appClient.collection('users').authWithPassword('rdtest-act-app@example.com', pw);
	let selfConfirmStatus = 0;
	try {
		await appClient.collection('applications').update(app1.id, { screening_fee_confirmed: true });
	} catch (e) { selfConfirmStatus = e?.status ?? 0; }
	const afterSelf = await su.collection('applications').getOne(app1.id);
	check('applicant cannot self-confirm fee (rule)', selfConfirmStatus >= 400 && afterSelf.screening_fee_confirmed === false, `status ${selfConfirmStatus}`);

	// status reporting after submission
	r = await post(appS.cookie, '/dashboard/applicant', 'reportScreeningFee', { screening_payment_ref: 'ZELLE-TEST-2' });
	const afterReport = await su.collection('applications').getOne(app1.id);
	check('applicant can report/update reference after submission', (r.status === 303 || r.status === 200) && afterReport.screening_payment_ref === 'ZELLE-TEST-2', '');

	// staff confirms receipt
	r = await post(adminS.cookie, '/dashboard/manage', 'confirmScreeningFee', { id: app1.id });
	const afterConfirm = await su.collection('applications').getOne(app1.id);
	check('staff confirms fee received', (r.status === 303 || r.status === 200) && afterConfirm.screening_fee_confirmed === true, '');
	r = await post(appS.cookie, '/dashboard/applicant', 'reportScreeningFee', { screening_payment_ref: 'ZELLE-TEST-3' });
	check('reporting blocked after confirmation', r.status >= 400, `status ${r.status}`);

	// ---- approve + create PENDING lease ------------------------------------------
	r = await post(adminS.cookie, '/dashboard/manage', 'setApplicationStatus', { id: app1.id, status: 'approved', review_notes: '' });
	check('application approved', r.status === 303 || r.status === 200, '');

	const settingsBefore = await su.collection('settings').getList(1, 1, { sort: 'created' });
	r = await post(adminS.cookie, '/dashboard/manage', 'createLease', {
		applicant: applicant.id, start_date: '2026-11-01', end_date: '2027-10-31',
		monthly_rent: '2200.00', deposit: '1000.00'
	});
	const pendingLease = await su.collection('leases').getFirstListItem(`tenant = "${applicant.id}"`);
	leaseId = pendingLease.id;
	const userAfterCreate = await su.collection('users').getOne(applicant.id);
	const chargesAfterCreate = await su.collection('charges').getFullList({ filter: `lease = "${leaseId}"` });
	const settingsAfterCreate = await su.collection('settings').getOne(settingsBefore.items[0].id);
	check('createLease -> status pending', pendingLease.status === 'pending', pendingLease.status);
	check('createLease -> applicant NOT promoted', userAfterCreate.role === 'applicant', userAfterCreate.role);
	check('createLease -> no charges created', chargesAfterCreate.length === 0, `${chargesAfterCreate.length}`);
	check('createLease -> unit stays listed', settingsAfterCreate.is_available === true, '');

	// second pending lease blocked
	r = await post(adminS.cookie, '/dashboard/manage', 'createLease', {
		applicant: applicant.id, start_date: '2026-12-01', end_date: '2027-11-30',
		monthly_rent: '2200.00', deposit: '1000.00'
	});
	check('second open lease blocked while pending exists', r.status >= 400, `status ${r.status}`);

	// ---- activation gating ---------------------------------------------------------
	r = await post(adminS.cookie, '/dashboard/manage', 'activateLease', { lease: leaseId });
	check('activation rejected without signed lease', r.status >= 400, `status ${r.status}`);

	// upload signed lease PDF to the pending lease
	const pdfFd = new FormData();
	pdfFd.append('lease', leaseId);
	pdfFd.append('file', new File([Uint8Array.from(atob(png64), (c) => c.charCodeAt(0))], 'signed.pdf', { type: 'application/pdf' }));
	const up = await fetch(`${APP}/dashboard/manage/signed-lease`, {
		method: 'POST',
		headers: { cookie: adminS.cookie, accept: 'application/json' },
		body: pdfFd
	});
	check('signed lease PDF uploaded to pending lease', up.status === 200, `status ${up.status}`);

	// activate
	r = await post(adminS.cookie, '/dashboard/manage', 'activateLease', { lease: leaseId });
	const leaseAfter = await su.collection('leases').getOne(leaseId);
	const userAfter = await su.collection('users').getOne(applicant.id);
	const chargesAfter = await su.collection('charges').getFullList({ filter: `lease = "${leaseId}"` });
	const settingsAfter = await su.collection('settings').getOne(settingsBefore.items[0].id);
	check('activation succeeds', r.status === 303 || r.status === 200, `status ${r.status}`);
	check('lease active after activation', leaseAfter.status === 'active', leaseAfter.status);
	check('applicant granted Tenant access at activation', userAfter.role === 'tenant', userAfter.role);
	check('move-in charges created as DRAFTS (nothing published)',
		chargesAfter.length === 13 && chargesAfter.every((c) => c.status === 'draft'),
		`${chargesAfter.length} charges, statuses: ${[...new Set(chargesAfter.map((c) => c.status))].join(',')}`);
	check('unit delisted at activation', settingsAfter.is_available === false, '');

	// retry: no duplicates, no repeated transitions
	r = await post(adminS.cookie, '/dashboard/manage', 'activateLease', { lease: leaseId });
	const chargesRetry = await su.collection('charges').getFullList({ filter: `lease = "${leaseId}"` });
	check('retry activation is safe (already active, no duplicate charges)',
		(r.status === 303 || r.status === 200) && r.body.includes('already active') && chargesRetry.length === 13,
		`charges: ${chargesRetry.length}`);

	// tenant view: drafts are invisible to the new tenant
	const tenantClient = new PocketBase(PB);
	await tenantClient.collection('users').authWithPassword('rdtest-act-app@example.com', pw);
	const tenantCharges = await tenantClient.collection('charges').getFullList({ filter: `lease = "${leaseId}"` });
	check('new tenant sees no charges until staff publishes', tenantCharges.length === 0, `${tenantCharges.length} visible`);

	// ---- fee snapshot stability across price change --------------------------------
	r = await post(adminS.cookie, '/dashboard/manage', 'updateSettings', {
		unit_name: 'Rental Unit', description: '', address: '', monthly_rent: '2250.00',
		deposit: '500.00', min_lease_months: '3', available_date: '', screening_fee: '45.00'
	});
	check('settings fee configurable to $45.00', r.status === 303 || r.status === 200, `status ${r.status}`);
	const applicant2 = await su.collection('users').create({ email: 'rdtest-act-app2@example.com', password: pw, passwordConfirm: pw, name: 'Second Applicant', role: 'applicant' });
	const app2S = await login('rdtest-act-app2@example.com', pw);
	await post(app2S.cookie, '/dashboard/applicant', 'saveApplication', {
		full_name: 'Second Applicant', phone: '555-0200', current_address: '', employer: '', monthly_income: '', move_in_date: '', notes: ''
	});
	await post(app2S.cookie, '/dashboard/applicant', 'submitApplication', { screening_payment_ref: '' });
	const app2 = await su.collection('applications').getFirstListItem(`applicant = "${applicant2.id}"`);
	const app1Again = await su.collection('applications').getOne(app1.id);
	check('new submission snapshots the new fee ($45.00)', app2.screening_fee_cents === 4500, `fee=${app2.screening_fee_cents}`);
	check('earlier application keeps its $35.00 snapshot', app1Again.screening_fee_cents === 3500, `fee=${app1Again.screening_fee_cents}`);
	check('fee state stays separate from application/lease status',
		app1Again.status === 'approved' && leaseAfter.status === 'active' && app1Again.screening_fee_confirmed === true, '');
	await su.collection('users').delete(applicant2.id).catch(() => {});
} finally {
	if (leaseId) {
		const docs = await su.collection('documents').getFullList({ filter: `lease = "${leaseId}"` }).catch(() => []);
		for (const d of docs) await su.collection('documents').delete(d.id).catch(() => {});
		await su.collection('leases').delete(leaseId).catch(() => {});
	}
	if (applicant) {
		const apps = await su.collection('applications').getFullList({ filter: `applicant = "${applicant.id}"` }).catch(() => []);
		for (const a of apps) await su.collection('applications').delete(a.id).catch(() => {});
		await su.collection('users').delete(applicant.id).catch(() => {});
	}
	if (admin) await su.collection('users').delete(admin.id).catch(() => {});
	await resetSettings().catch(() => {});
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
