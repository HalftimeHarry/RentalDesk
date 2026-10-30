/**
 * Isolated verification for maintenance-request photos.
 *
 * Creates two throwaway tenant users and one throwaway maintenance request,
 * then checks — using the users' OWN PocketBase clients (rules enforced):
 *   1. Owner can create a request with a photo attached (upload works).
 *   2. The photo persists on the record and downloads with the owner's token.
 *   3. Appending via 'photos+' adds a second photo WITHOUT replacing the first.
 *   4. Another tenant cannot view the record nor download its file.
 *   5. Collection rules still restrict to requester/staff (unchanged).
 *
 * All test records are deleted at the end. Existing data is never touched.
 * Usage: node --env-file=.env scripts/verify-maintenance-photos.mjs
 */
import PocketBase from 'pocketbase';

const url = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const email = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;

if (!email || !password) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD in env.');
	process.exit(1);
}

// 1x1 transparent PNG (valid image/png payload).
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);
const PNG2 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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
const ownerCred = {
	email: `mt-photo-owner-${stamp}@example.com`,
	password: `Test!${stamp}Aa`,
	passwordConfirm: `Test!${stamp}Aa`,
	name: 'MT Photo Test Owner',
	role: 'tenant'
};
const intruderCred = { ...ownerCred, email: `mt-photo-intruder-${stamp}@example.com`, name: 'MT Photo Test Intruder' };

const results = [];
const check = (name, ok, detail = '') => {
	results.push({ name, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

let owner = null;
let intruder = null;
let requestId = null;

try {
	owner = await admin.collection('users').create(ownerCred);
	intruder = await admin.collection('users').create(intruderCred);

	const pbOwner = new PocketBase(url);
	await pbOwner.collection('users').authWithPassword(ownerCred.email, ownerCred.password);
	const pbIntruder = new PocketBase(url);
	await pbIntruder.collection('users').authWithPassword(intruderCred.email, intruderCred.password);

	// 1. Create with a photo, as the owning tenant (createRule enforced).
	const fd = new FormData();
	fd.append('requester', owner.id);
	fd.append('title', `TEST photo request ${stamp}`);
	fd.append('description', 'Isolated verification record — safe to delete.');
	fd.append('status', 'open');
	fd.append('photos', new Blob([PNG], { type: 'image/png' }), 'test-one.png');
	const created = await pbOwner.collection('maintenance_requests').create(fd);
	requestId = created.id;
	check('owner creates request with photo', Array.isArray(created.photos) && created.photos.length === 1, `photos: [${created.photos}]`);

	// 2. Persistence + owner download (same mechanism as the /files proxy).
	const fetched = await pbOwner.collection('maintenance_requests').getOne(requestId);
	const firstFile = fetched.photos[0];
	check('photo persists on the record', fetched.photos.length === 1 && !!firstFile);
	const ownerToken = await pbOwner.files.getToken();
	const ownerFile = await fetch(
		`${url}/api/files/maintenance_requests/${requestId}/${firstFile}?token=${encodeURIComponent(ownerToken)}`
	);
	check('owner downloads the photo (protected file)', ownerFile.status === 200, `HTTP ${ownerFile.status}`);

	// 3. Append without replacing (photos+).
	const fd2 = new FormData();
	fd2.append('photos+', new Blob([PNG2], { type: 'image/png' }), 'test-two.png');
	const updated = await pbOwner.collection('maintenance_requests').update(requestId, fd2);
	check(
		'append keeps the earlier photo',
		updated.photos.length === 2 && updated.photos[0] === firstFile,
		`photos: [${updated.photos}]`
	);

	// 4. Intruder access is denied (record + file).
	let recordStatus = 0;
	try {
		await pbIntruder.collection('maintenance_requests').getOne(requestId);
		recordStatus = 200;
	} catch (e) {
		recordStatus = e?.status ?? 0;
	}
	check("intruder cannot view the record", recordStatus === 404 || recordStatus === 403, `HTTP ${recordStatus}`);
	const intruderToken = await pbIntruder.files.getToken();
	const intruderFile = await fetch(
		`${url}/api/files/maintenance_requests/${requestId}/${firstFile}?token=${encodeURIComponent(intruderToken)}`
	);
	check("intruder cannot download the photo", intruderFile.status === 403 || intruderFile.status === 404, `HTTP ${intruderFile.status}`);

	// 5. Rules unchanged: still requester-or-staff.
	const col = await admin.collections.getOne('maintenance_requests');
	check(
		'view/list rules unchanged (requester or staff)',
		String(col.viewRule).includes('requester = @request.auth.id') &&
			String(col.listRule).includes('requester = @request.auth.id')
	);
} catch (e) {
	check('verification completed without exceptions', false, e?.message ?? String(e));
} finally {
	// Cleanup of the isolated test records only.
	if (requestId) await admin.collection('maintenance_requests').delete(requestId).catch(() => {});
	if (owner) await admin.collection('users').delete(owner.id).catch(() => {});
	if (intruder) await admin.collection('users').delete(intruder.id).catch(() => {});
	console.log('Cleanup: removed isolated test request and test users.');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
