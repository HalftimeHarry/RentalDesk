/**
 * RentalDesk — PocketBase API-rule verification.
 *
 * Creates four temporary ordinary accounts (applicant A, applicant B, admin,
 * owner), runs an access-control test matrix against the live API rules, and
 * cleans up all test data afterwards. Superuser credentials are used ONLY to
 * create/remove the test fixtures — every check runs as an ordinary user or
 * anonymously. No credentials are printed.
 *
 * Usage: node --env-file=.env scripts/verify-pocketbase-rules.mjs
 */
import PocketBase from 'pocketbase';

const url = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const suEmail = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const suPassword = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!suEmail || !suPassword) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD.');
	process.exit(1);
}

const TEST_PW = `Rd!${Math.random().toString(36).slice(2)}xQ9`;
const EMAILS = {
	owner: 'rdtest-owner@example.com',
	admin: 'rdtest-admin@example.com',
	a: 'rdtest-a@example.com',
	b: 'rdtest-b@example.com'
};

const results = [];
function check(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Resolves { status } when the promise is rejected with a 4xx, null when it succeeds. */
async function blocked(promise) {
	try {
		await promise;
		return null;
	} catch (e) {
		return { status: e?.status ?? 0 };
	}
}

const su = new PocketBase(url);
su.autoCancellation(false);
await su.collection('_superusers').authWithPassword(suEmail, suPassword);

const anon = new PocketBase(url);
anon.autoCancellation(false);

const createdUserIds = [];
const createdRecords = { applications: [], documents: [], leases: [], charges: [], messages: [] };

async function cleanup() {
	for (const [col, ids] of Object.entries(createdRecords)) {
		for (const id of ids) await su.collection(col).delete(id).catch(() => {});
	}
	for (const id of createdUserIds) await su.collection('users').delete(id).catch(() => {});
}

try {
	// ---- fixtures -------------------------------------------------------------
	// A and B register through the PUBLIC endpoint (role forced to applicant).
	for (const key of ['a', 'b']) {
		const rec = await anon.collection('users').create({
			email: EMAILS[key],
			password: TEST_PW,
			passwordConfirm: TEST_PW,
			name: `Test ${key.toUpperCase()}`,
			role: 'applicant'
		});
		createdUserIds.push(rec.id);
	}
	// Staff fixtures can only be created by the superuser (management roles).
	for (const key of ['admin', 'owner']) {
		const rec = await su.collection('users').create({
			email: EMAILS[key],
			password: TEST_PW,
			passwordConfirm: TEST_PW,
			name: `Test ${key}`,
			role: key
		});
		createdUserIds.push(rec.id);
	}

	const asUser = async (email) => {
		const c = new PocketBase(url);
		c.autoCancellation(false);
		await c.collection('users').authWithPassword(email, TEST_PW);
		return c;
	};
	const A = await asUser(EMAILS.a);
	const B = await asUser(EMAILS.b);
	const ADMIN = await asUser(EMAILS.admin);
	const OWNER = await asUser(EMAILS.owner);
	const idOf = (c) => c.authStore.record.id;

	// ---- anonymous ------------------------------------------------------------
	const anonSettings = await anon.collection('settings').getList(1, 1).then(() => true).catch(() => false);
	check('anon: landing page can read public settings', anonSettings);

	const anonApps = await anon.collection('applications').getFullList().catch(() => null);
	check('anon: applications list is empty/blocked', anonApps !== null && anonApps.length === 0);

	const anonUsers = await anon.collection('users').getFullList().catch(() => null);
	check('anon: users list is empty/blocked', anonUsers !== null && anonUsers.length === 0);

	const spoofCreate = await blocked(
		anon.collection('users').create({
			email: 'rdtest-spoof@example.com',
			password: TEST_PW,
			passwordConfirm: TEST_PW,
			role: 'admin'
		})
	);
	check('anon: cannot self-register with a management role', !!spoofCreate, `status ${spoofCreate?.status}`);

	// ---- applicant A ----------------------------------------------------------
	const appA = await A.collection('applications').create({
		applicant: idOf(A),
		status: 'draft',
		full_name: 'Test A',
		phone: '555-0100'
	});
	createdRecords.applications.push(appA.id);
	check('applicant A: can create own application', !!appA.id);

	const spoofApp = await blocked(
		A.collection('applications').create({ applicant: idOf(B), status: 'draft', full_name: 'Spoof' })
	);
	check('applicant A: cannot create an application as another user', !!spoofApp, `status ${spoofApp?.status}`);

	const selfName = await blocked(A.collection('users').update(idOf(A), { name: 'Test A renamed' }));
	check('applicant A: can update own name', selfName === null);

	const selfPromoteAdmin = await blocked(A.collection('users').update(idOf(A), { role: 'admin' }));
	check('applicant A: cannot promote self to admin', !!selfPromoteAdmin, `status ${selfPromoteAdmin?.status}`);

	const selfPromoteTenant = await blocked(A.collection('users').update(idOf(A), { role: 'tenant' }));
	check('applicant A: cannot flip self to tenant', !!selfPromoteTenant, `status ${selfPromoteTenant?.status}`);

	const selfReview = await blocked(A.collection('applications').update(appA.id, { status: 'approved' }));
	check('applicant A: cannot approve own application', !!selfReview, `status ${selfReview?.status}`);

	const submit = await blocked(A.collection('applications').update(appA.id, { status: 'submitted', submitted: new Date().toISOString() }));
	check('applicant A: can submit own application', submit === null);

	// staff discovery for messaging
	const visibleUsers = await A.collection('users').getFullList();
	const visibleRoles = visibleUsers.map((u) => u.role).sort();
	check(
		'applicant A: can discover staff accounts for messaging',
		visibleRoles.includes('admin') && visibleRoles.includes('owner') && !visibleUsers.some((u) => u.id === idOf(B)),
		`sees roles [${visibleRoles.join(',')}]`
	);

	// document upload (multipart) — a tiny valid PNG (magic bytes) since the
	// field now restricts to PDF/JPEG/PNG with content sniffing
	const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(0)]);
	const fd = new FormData();
	fd.append('owner', idOf(A));
	fd.append('kind', 'identification');
	fd.append('title', 'A test ID');
	fd.append('application', appA.id);
	fd.append('file', new File([pngBytes], 'a-id.png', { type: 'image/png' }));
	const docA = await A.collection('documents').create(fd);
	createdRecords.documents.push(docA.id);
	check('applicant A: can upload own document', !!docA.id);

	// ---- applicant B: cross-user access --------------------------------------
	const bReadApp = await blocked(B.collection('applications').getOne(appA.id));
	check('applicant B: cannot read A’s application', bReadApp?.status === 404, `status ${bReadApp?.status}`);

	const bApps = await B.collection('applications').getFullList();
	check('applicant B: application list contains only own records', bApps.length === 0);

	const bReadDoc = await blocked(B.collection('documents').getOne(docA.id));
	check('applicant B: cannot read A’s document record', bReadDoc?.status === 404, `status ${bReadDoc?.status}`);

	const bReadUserA = await blocked(B.collection('users').getOne(idOf(A)));
	check('applicant B: cannot read A’s user record', bReadUserA?.status === 404, `status ${bReadUserA?.status}`);

	// File downloads: the app always issues short-lived file tokens via its
	// /files route. With a token, the record viewRule is enforced. The field is
	// also marked `protected` so newer PocketBase versions deny tokenless access.
	const fileField = (await su.collections.getOne('documents')).fields.find((f) => f.name === 'file');
	check('documents.file is marked protected', fileField?.protected === true);

	const fileUrl = `${url}/api/files/documents/${docA.id}/${docA.file}`;
	const tokenB = await B.files.getToken();
	const bFile = await fetch(`${fileUrl}?token=${tokenB}`);
	check('applicant B: token does not unlock A’s document file', bFile.status === 403 || bFile.status === 404, `status ${bFile.status}`);
	const tokenA = await A.files.getToken();
	const aFile = await fetch(`${fileUrl}?token=${tokenA}`);
	check('applicant A: can download own document file', aFile.status === 200, `status ${aFile.status}`);
	const noToken = await fetch(fileUrl);
	console.log(`NOTE  tokenless file URL status on this build: ${noToken.status} (URLs carry random names; the app only issues tokenized links)`);

	// ---- messages -------------------------------------------------------------
	const msg = await A.collection('messages').create({ sender: idOf(A), recipient: idOf(ADMIN), body: 'Hello from A', read: false });
	createdRecords.messages.push(msg.id);
	check('applicant A: can message management', !!msg.id);

	const bMsgs = await B.collection('messages').getFullList();
	check('applicant B: cannot see A’s messages', bMsgs.length === 0);

	const spoofMsg = await blocked(B.collection('messages').create({ sender: idOf(A), recipient: idOf(B), body: 'spoof' }));
	check('applicant B: cannot send a message as A', !!spoofMsg, `status ${spoofMsg?.status}`);

	// ---- admin ----------------------------------------------------------------
	const adminApps = await ADMIN.collection('applications').getFullList();
	check('admin: can list applications', adminApps.some((x) => x.id === appA.id));

	const review = await blocked(ADMIN.collection('applications').update(appA.id, { status: 'under_review' }));
	check('admin: can set application status', review === null);

	const adminMsgs = await ADMIN.collection('messages').getFullList();
	check('admin: can see applicant messages', adminMsgs.some((m) => m.id === msg.id));

	const flipB = await blocked(ADMIN.collection('users').update(idOf(B), { role: 'tenant' }));
	check('admin: can flip applicant to tenant (lease flow)', flipB === null);

	const adminPromote = await blocked(ADMIN.collection('users').update(idOf(B), { role: 'admin' }));
	check('admin: cannot grant management roles', !!adminPromote, `status ${adminPromote?.status}`);

	const adminTouchOwner = await blocked(ADMIN.collection('users').update(idOf(OWNER), { name: 'hacked' }));
	check('admin: cannot modify the owner account', !!adminTouchOwner, `status ${adminTouchOwner?.status}`);

	// ---- lease + charges (admin creates, tenant reads, others blocked) --------
	const lease = await ADMIN.collection('leases').create({
		tenant: idOf(B),
		start_date: '2026-01-15',
		end_date: '2026-04-14',
		monthly_rent_cents: 225000,
		deposit_cents: 50000,
		status: 'active'
	});
	createdRecords.leases.push(lease.id);
	const charge = await ADMIN.collection('charges').create({
		lease: lease.id,
		period: '2026-01',
		type: 'rent',
		description: 'Prorated rent — January 2026',
		amount_cents: 123387,
		due_date: '2026-01-15',
		prorated: true,
		status: 'published'
	});
	createdRecords.charges.push(charge.id);
	check('admin: can create lease and charge', !!lease.id && !!charge.id);

	const bLeases = await B.collection('leases').getFullList();
	check('tenant B: sees own lease', bLeases.some((l) => l.id === lease.id));

	const bCharges = await B.collection('charges').getFullList();
	check('tenant B: sees own charges', bCharges.some((c) => c.id === charge.id));

	const aReadCharge = await blocked(A.collection('charges').getOne(charge.id));
	check('applicant A: cannot read B’s charge', aReadCharge?.status === 404, `status ${aReadCharge?.status}`);

	const aLeases = await A.collection('leases').getFullList();
	check('applicant A: lease list is empty', aLeases.length === 0);

	const bCreateCharge = await blocked(
		B.collection('charges').create({ lease: lease.id, type: 'other', description: 'x', amount_cents: 1, due_date: '2026-02-01' })
	);
	check('tenant B: cannot create charges', !!bCreateCharge, `status ${bCreateCharge?.status}`);

	const bEndLease = await blocked(B.collection('leases').update(lease.id, { status: 'ended' }));
	check('tenant B: cannot modify the lease', !!bEndLease, `status ${bEndLease?.status}`);

	// ---- owner ----------------------------------------------------------------
	const ownerPromote = await blocked(OWNER.collection('users').update(idOf(B), { role: 'admin' }));
	check('owner: can assign the admin role', ownerPromote === null);
	const ownerRevert = await blocked(OWNER.collection('users').update(idOf(B), { role: 'tenant' }));
	check('owner: can revert the admin role', ownerRevert === null);
} finally {
	await cleanup();
	console.log('\nTemporary test users and records removed.');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) process.exit(1);
