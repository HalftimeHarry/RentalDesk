/**
 * End-to-end verification of signed-inspection email confirmation + private
 * manager notes, on the ISOLATED stack only.
 *
 * Covers:
 *  - manager_notes never reach the tenant-visible record (direct PocketBase
 *    record access included) nor the private collections for tenants;
 *    staff still read them via the staff-only collection.
 *  - Finalization: stage 'signed' only with signatures + frozen snapshot +
 *    persisted final PDF (final_pdf). signed_copy stays manual-upload only.
 *  - Delivery tracking: one row per resolved recipient (landlord = created_by,
 *    tenant = lease account), version-scoped to the signed record; email
 *    disabled => rows stay pending; retry creates no duplicates and never
 *    resends successes; extra named tenants surface a limitation.
 *  - Editing after signing forks a new unsigned revision; the signed original
 *    and its delivery rows are preserved.
 *
 * Usage: node --env-file=.env.test --env-file=.env.test.local scripts/verify-inspection-signed-email.mjs
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

const PNG64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const png = () => new File([Uint8Array.from(atob(PNG64), (c) => c.charCodeAt(0))], 'sig.png', { type: 'image/png' });

const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection('_superusers').authWithPassword(suEmail, suPassword);

const cookieFrom = (res) => (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('pb_auth='))?.split(';')[0] ?? '';
async function login(email, password) {
	const res = await fetch(`${APP}/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
		body: new URLSearchParams({ email, password }),
		redirect: 'manual'
	});
	return cookieFrom(res);
}

const pw = `Rd!${Math.random().toString(36).slice(2)}sE9`;
const fixtures = { users: [], leases: [], inspections: [], notifications: [], notes: [] };
try {
	const staff = await su.collection('users').create({ email: 'rdtest-se-staff@example.com', password: pw, passwordConfirm: pw, name: 'Sign Email Staff', role: 'admin' });
	const tenant = await su.collection('users').create({ email: 'rdtest-se-tenant@example.com', password: pw, passwordConfirm: pw, name: 'Sign Email Tenant', role: 'tenant' });
	fixtures.users.push(staff.id, tenant.id);
	const lease = await su.collection('leases').create({ tenant: tenant.id, start_date: '2026-10-30', end_date: '2027-10-29', monthly_rent_cents: 220000, deposit_cents: 100000, status: 'active' });
	fixtures.leases.push(lease.id);

	const staffCookie = await login('rdtest-se-staff@example.com', pw);

	// create inspection through the app
	const cfd = new FormData();
	cfd.append('lease', lease.id); cfd.append('type', 'move_in'); cfd.append('date', '2026-10-30');
	const created = await fetch(`${APP}/dashboard/inspections?/createInspection`, { method: 'POST', headers: { cookie: staffCookie, accept: 'text/html' }, body: cfd, redirect: 'manual' });
	const inspId = (created.headers.get('location') ?? '').split('/').pop();
	fixtures.inspections.push(inspId);
	check('inspection created through the app', created.status === 303 && !!inspId, `status ${created.status}`);

	// save content incl. a private manager note + two tenant names (limitation path)
	const sfd = new FormData();
	sfd.append('address', '1 Test Way'); sfd.append('unit', '102');
	sfd.append('tenant_names', 'Sign Email Tenant, Roommate Extra');
	sfd.append('occupancy', 'occupied'); sfd.append('move_in_date', '2026-10-30'); sfd.append('move_out_date', '');
	sfd.append('date', '2026-10-30'); sfd.append('type', 'move_in');
	sfd.append('notes', 'general notes'); sfd.append('manager_notes', 'PRIVATE-MARKER-9Z2');
	sfd.append('checklist', '[]'); sfd.append('proposed_deductions', '[]'); sfd.append('stage', 'in_progress');
	const saved = await fetch(`${APP}/dashboard/inspections/${inspId}?/saveInspection`, { method: 'POST', headers: { cookie: staffCookie, accept: 'text/html' }, body: sfd, redirect: 'manual' });
	check('inspection saved with private note', saved.status === 200 || saved.status === 303, `status ${saved.status}`);

	// ---- privacy: tenant direct record access -------------------------------------
	const rec = await su.collection('inspections').getOne(inspId);
	check('record field manager_notes stays empty', rec.manager_notes === '', JSON.stringify(rec.manager_notes));
	const note = await su.collection('inspection_private_notes').getFirstListItem(`inspection = "${inspId}"`);
	fixtures.notes.push(note.id);
	check('staff-only collection holds the note', note.body === 'PRIVATE-MARKER-9Z2', '');

	const tenantPb = new PocketBase(PB);
	await tenantPb.collection('users').authWithPassword('rdtest-se-tenant@example.com', pw);
	const tenantView = await tenantPb.collection('inspections').getOne(inspId);
	check('tenant direct record access shows no manager notes', (tenantView.manager_notes ?? '') === '', '');
	const tenantNotes = await tenantPb.collection('inspection_private_notes').getFullList().catch(() => null);
	check('tenant cannot read private notes collection', tenantNotes === null || tenantNotes.length === 0, tenantNotes === null ? 'rejected' : `${tenantNotes.length} visible`);
	const tenantNotif = await tenantPb.collection('inspection_notifications').getFullList().catch(() => null);
	check('tenant cannot read delivery records', tenantNotif === null || tenantNotif.length === 0, '');

	// ---- sign both sides -----------------------------------------------------------
	for (const who of ['landlord', 'tenant']) {
		const fd = new FormData();
		fd.append(`${who}_name`, who === 'landlord' ? 'Sign Email Staff' : 'Sign Email Tenant');
		fd.append(`${who}_ack`, 'on');
		fd.append(`${who}_file`, png());
		const res = await fetch(`${APP}/dashboard/inspections/${inspId}?/sign${who === 'landlord' ? 'Landlord' : 'Tenant'}`, { method: 'POST', headers: { cookie: staffCookie, accept: 'text/html' }, body: fd, redirect: 'manual' });
		const body = await res.text();
		if (who === 'tenant') {
			check('second signature reports fully signed', body.includes('fully signed'), `status ${res.status}`);
			check('delivery note mentions disabled email (pending)', body.includes('pending'), '');
			check('extra named tenant limitation surfaced', body.includes('other named tenant'), '');
		}
	}

	const signed = await su.collection('inspections').getOne(inspId);
	check('stage signed only after all persisted', signed.stage === 'signed' && !!signed.signed_snapshot && !!signed.final_pdf, `stage=${signed.stage} pdf=${signed.final_pdf ? 'set' : 'missing'}`);
	check('signed_copy untouched (manual uploads only)', signed.signed_copy === '', '');
	check('snapshot excludes manager notes', !JSON.stringify(signed.signed_snapshot).includes('PRIVATE-MARKER'), '');

	// ---- delivery tracking -----------------------------------------------------------
	const rows = await su.collection('inspection_notifications').getFullList({ filter: `inspection = "${inspId}"`, sort: 'created' });
	fixtures.notifications.push(...rows.map((r) => r.id));
	check('one delivery row per resolved recipient', rows.length === 2, `${rows.length}`);
	check('landlord row = creator email, tenant row = lease account email',
		rows.find((r) => r.role === 'landlord')?.email === 'rdtest-se-staff@example.com' &&
		rows.find((r) => r.role === 'tenant')?.email === 'rdtest-se-tenant@example.com',
		rows.map((r) => `${r.role}:${r.email}`).join(', '));
	check('email disabled => rows pending, no attempts counted', rows.every((r) => r.status === 'pending' && r.attempts === 0), rows.map((r) => r.status).join(','));

	// retry: no duplicates, still pending (email disabled), successes untouched
	const retry = await fetch(`${APP}/dashboard/inspections/${inspId}?/resendInspectionNotice`, { method: 'POST', headers: { cookie: staffCookie, accept: 'text/html' }, body: new FormData(), redirect: 'manual' });
	const rowsAfter = await su.collection('inspection_notifications').getFullList({ filter: `inspection = "${inspId}"` });
	check('retry creates no duplicates and stays pending while disabled',
		(retry.status === 200 || retry.status === 303) && rowsAfter.length === 2 && rowsAfter.every((r) => r.status === 'pending'),
		`status ${retry.status}, rows ${rowsAfter.length}`);

	// ---- page-level privacy: the TENANT's email never enters the staff page -----
	// (the staff user's own email appears in their session header — expected).
	const pageHtml = await (await fetch(`${APP}/dashboard/inspections/${inspId}`, { headers: { cookie: staffCookie } })).text();
	check('inspection page shows recipients by name (no tenant email)',
		pageHtml.includes('Sign Email Staff') && pageHtml.includes('Sign Email Tenant') &&
		!pageHtml.includes('rdtest-se-tenant@example.com'),
		'');

	// ---- revision safety ---------------------------------------------------------------
	const efd = new FormData();
	for (const [k, v] of Object.entries({ address: '1 Test Way', unit: '102', tenant_names: 'Sign Email Tenant, Roommate Extra', occupancy: 'occupied', move_in_date: '2026-10-30', move_out_date: '', date: '2026-10-31', type: 'move_in', notes: 'edited after signing', manager_notes: '', stage: 'in_progress' })) efd.append(k, v);
	efd.append('checklist', '[]'); efd.append('proposed_deductions', '[]');
	await fetch(`${APP}/dashboard/inspections/${inspId}?/saveInspection`, { method: 'POST', headers: { cookie: staffCookie, accept: 'text/html' }, body: efd, redirect: 'manual' });
	const original = await su.collection('inspections').getOne(inspId);
	const revisions = await su.collection('inspections').getFullList({ filter: `revision_of = "${inspId}"` });
	if (revisions[0]) fixtures.inspections.push(revisions[0].id);
	check('edit after signing forks a new unsigned revision', revisions.length === 1 && revisions[0].stage === 'draft', `${revisions.length} revision(s)`);
	check('signed original preserved (stage + snapshot + pdf intact)',
		original.stage === 'signed' && !!original.signed_snapshot && !!original.final_pdf && original.notes === 'general notes', '');
	const rowsAfterFork = await su.collection('inspection_notifications').getFullList({ filter: `inspection = "${inspId}"` });
	check('delivery rows stay version-scoped to the signed original', rowsAfterFork.length === 2, '');
} finally {
	for (const id of fixtures.notifications) await su.collection('inspection_notifications').delete(id).catch(() => {});
	for (const id of fixtures.notes) await su.collection('inspection_private_notes').delete(id).catch(() => {});
	for (const id of fixtures.inspections) await su.collection('inspections').delete(id).catch(() => {});
	for (const id of fixtures.leases) await su.collection('leases').delete(id).catch(() => {});
	for (const id of fixtures.users) await su.collection('users').delete(id).catch(() => {});
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
