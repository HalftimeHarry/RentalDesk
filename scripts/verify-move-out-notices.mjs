/**
 * Isolated verification for move-out notices.
 *
 * Creates throwaway users (tenant, intruder tenant, staff), a throwaway lease,
 * and one throwaway notice — then checks with the users' OWN clients:
 *   1. Tenant can submit a notice with its PDF copy attached (persists).
 *   2. The PDF downloads with the tenant's own file token.
 *   3. The tenant CANNOT update a submitted notice (corrections are new records).
 *   4. Another tenant cannot view the notice nor download its PDF.
 *   5. Staff can view + acknowledge the notice.
 *   6. Collection rules still restrict to tenant/staff.
 *
 * All test records are deleted at the end. Existing data is never touched.
 * Usage: node --env-file=.env scripts/verify-move-out-notices.mjs
 */
import PocketBase from 'pocketbase';

const url = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const email = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!email || !password) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD in env.');
	process.exit(1);
}

// Smallest valid PDF (enough for PocketBase's application/pdf check).
const PDF = Buffer.from(
	'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXT4+CmVuZG9iagp0cmFpbGVyCjw8L1Jvb3QgMSAwIFIvU2l6ZSA0Pj4K',
	'base64'
);

const admin = new PocketBase(url);
admin.autoCancellation(false);
try {
	await admin.collection('_superusers').authWithPassword(email, password);
} catch {
	await admin.admins.authWithPassword(email, password);
}

const stamp = Date.now();
const mk = (name, role) => ({
	email: `mon-${name}-${stamp}@example.com`,
	password: `Test!${stamp}Aa`,
	passwordConfirm: `Test!${stamp}Aa`,
	name: `MON Test ${name}`,
	role
});

const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

let tenant = null;
let intruder = null;
let staff = null;
let lease = null;
let noticeId = null;

try {
	tenant = await admin.collection('users').create(mk('tenant', 'tenant'));
	intruder = await admin.collection('users').create(mk('intruder', 'tenant'));
	staff = await admin.collection('users').create(mk('staff', 'admin'));
	lease = await admin.collection('leases').create({
		tenant: tenant.id,
		start_date: '2026-01-01',
		end_date: '2026-12-31',
		monthly_rent_cents: 100000,
		deposit_cents: 50000,
		status: 'active'
	});

	const pbTenant = new PocketBase(url);
	await pbTenant.collection('users').authWithPassword(`mon-tenant-${stamp}@example.com`, `Test!${stamp}Aa`);
	const pbIntruder = new PocketBase(url);
	await pbIntruder.collection('users').authWithPassword(`mon-intruder-${stamp}@example.com`, `Test!${stamp}Aa`);
	const pbStaff = new PocketBase(url);
	await pbStaff.collection('users').authWithPassword(`mon-staff-${stamp}@example.com`, `Test!${stamp}Aa`);

	// 1. Tenant submits a notice with its frozen PDF copy.
	const fd = new FormData();
	fd.append('lease', lease.id);
	fd.append('tenant', tenant.id);
	fd.append('tenant_names', 'MON Test tenant');
	fd.append('property_address', '123 Test St');
	fd.append('unit', 'Test Unit');
	fd.append('requested_date', '2026-12-01');
	fd.append('signer_name', 'MON Test tenant');
	fd.append('submitted_at', new Date().toISOString());
	fd.append('status', 'submitted');
	fd.append('client_token', `verify-${stamp}`);
	fd.append('notice_pdf', new Blob([PDF], { type: 'application/pdf' }), 'notice.pdf');
	const created = await pbTenant.collection('move_out_notices').create(fd);
	noticeId = created.id;
	check(
		'tenant submits notice with PDF copy',
		!!created.notice_pdf && !!created.submitted_at && created.status === 'submitted',
		`pdf: ${created.notice_pdf}`
	);

	// 2. Tenant downloads the PDF (same mechanism as the /files proxy).
	const token = await pbTenant.files.getToken();
	const fileRes = await fetch(
		`${url}/api/files/move_out_notices/${noticeId}/${created.notice_pdf}?token=${encodeURIComponent(token)}`
	);
	check('tenant downloads the notice PDF (protected file)', fileRes.status === 200, `HTTP ${fileRes.status}`);

	// 3. Tenant cannot update a submitted notice.
	let updateStatus = 0;
	try {
		await pbTenant.collection('move_out_notices').update(noticeId, { notes: 'tamper' });
		updateStatus = 200;
	} catch (e) {
		updateStatus = e?.status ?? 0;
	}
	check('tenant cannot edit a submitted notice', updateStatus === 403 || updateStatus === 404, `HTTP ${updateStatus}`);

	// 4. Intruder denied (record + file).
	let viewStatus = 0;
	try {
		await pbIntruder.collection('move_out_notices').getOne(noticeId);
		viewStatus = 200;
	} catch (e) {
		viewStatus = e?.status ?? 0;
	}
	check("another tenant cannot view the notice", viewStatus === 404 || viewStatus === 403, `HTTP ${viewStatus}`);
	const iToken = await pbIntruder.files.getToken();
	const iFile = await fetch(
		`${url}/api/files/move_out_notices/${noticeId}/${created.notice_pdf}?token=${encodeURIComponent(iToken)}`
	);
	check('another tenant cannot download the PDF', iFile.status === 403 || iFile.status === 404, `HTTP ${iFile.status}`);

	// 5. Staff can view + acknowledge.
	const staffView = await pbStaff.collection('move_out_notices').getOne(noticeId).catch(() => null);
	const acked = await pbStaff
		.collection('move_out_notices')
		.update(noticeId, { status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: staff.id })
		.catch(() => null);
	check('staff can view and acknowledge', !!staffView && acked?.status === 'acknowledged');

	// 6. Rules unchanged.
	const col = await admin.collections.getOne('move_out_notices');
	check(
		'rules restrict to tenant or staff',
		String(col.viewRule).includes('tenant = @request.auth.id') &&
			String(col.updateRule).includes('@request.auth.role = "owner"')
	);
} catch (e) {
	check('verification completed without exceptions', false, e?.message ?? String(e));
} finally {
	if (noticeId) await admin.collection('move_out_notices').delete(noticeId).catch(() => {});
	if (lease) await admin.collection('leases').delete(lease.id).catch(() => {});
	for (const u of [tenant, intruder, staff]) {
		if (u) await admin.collection('users').delete(u.id).catch(() => {});
	}
	console.log('Cleanup: removed isolated test notice, lease, and users.');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
