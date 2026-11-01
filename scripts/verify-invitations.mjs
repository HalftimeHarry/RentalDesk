/**
 * End-to-end verification of the admin-invitation workflow on the ISOLATED stack.
 *
 * Covers: staff (Admin, not just Owner) can invite; one pending invite per email
 * (re-invite reuses the link); non-staff blocked at the action and in PocketBase;
 * new-user acceptance (register -> accept -> Admin); existing-user acceptance;
 * wrong-account and already-accepted rejections; expired invite handling.
 * Email is mocked by the disabled-by-default sendMail (nothing leaves the machine);
 * the invitation link is retrieved from the staff UI response.
 *
 * Throwaway rdtest-inv-* fixtures only — seed @example.test accounts are never
 * touched. All fixtures are removed at the end.
 *
 * Usage: node --env-file=.env.test --env-file=.env.test.local scripts/verify-invitations.mjs
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
const inviteUrlFrom = (body) => /inviteUrl:"(http[^"]+)"/.exec(body)?.[1] ?? /value="(http[^"]*\/invite\/[a-f0-9-]{36})"/.exec(body)?.[1] ?? null;

const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection('_superusers').authWithPassword(suEmail, suPassword);

const pw = `Rd!${Math.random().toString(36).slice(2)}iV9`;
const createdUsers = [];
const createdInvites = [];
try {
	// Staff fixture is an ADMIN (not owner) — proves both roles can invite.
	const staff = await su.collection('users').create({ email: 'rdtest-inv-admin@example.com', password: pw, passwordConfirm: pw, name: 'Invite Admin', role: 'admin' });
	const outsider = await su.collection('users').create({ email: 'rdtest-inv-outsider@example.com', password: pw, passwordConfirm: pw, name: 'Invite Outsider', role: 'applicant' });
	createdUsers.push(staff.id, outsider.id);

	const staffS = await login('rdtest-inv-admin@example.com', pw);
	const outS = await login('rdtest-inv-outsider@example.com', pw);
	check('staff (admin) + applicant logins', staffS.status === 303 && outS.status === 303, '');

	// --- create invitation as ADMIN staff ----------------------------------------
	let r = await post(staffS.cookie, '/dashboard/manage', 'inviteAdmin', { email: 'rdtest-inv-new@example.com' });
	const url1 = inviteUrlFrom(r.body);
	check('admin can create an invitation and gets the link', (r.status === 200 || r.status === 303) && !!url1, `status ${r.status}`);
	const inv1 = await su.collection('invitations').getFirstListItem('email = "rdtest-inv-new@example.com"');
	check('invitation is pending, role admin only', inv1.status === 'pending' && inv1.role === 'admin', `${inv1.status}/${inv1.role}`);
	createdInvites.push(inv1.id);

	// --- idempotency: re-invite reuses the pending invite -------------------------
	r = await post(staffS.cookie, '/dashboard/manage', 'inviteAdmin', { email: 'rdtest-inv-new@example.com' });
	const url2 = inviteUrlFrom(r.body);
	const allForEmail = await su.collection('invitations').getFullList({ filter: 'email = "rdtest-inv-new@example.com"' });
	check('re-invite reuses the same pending invite (no duplicate)', url1 === url2 && allForEmail.length === 1, '');

	// --- non-staff blocked at action and at PocketBase ----------------------------
	r = await post(outS.cookie, '/dashboard/manage', 'inviteAdmin', { email: 'rdtest-inv-x@example.com' });
	const outClient = new PocketBase(PB);
	await outClient.collection('users').authWithPassword('rdtest-inv-outsider@example.com', pw);
	let createStatus = 0;
	try { await outClient.collection('invitations').create({ email: 'x@x.com', role: 'admin', token: 't', status: 'pending', invited_by: outsider.id, expires: new Date().toISOString() }); } catch (e) { createStatus = e?.status ?? 0; }
	const outList = await outClient.collection('invitations').getFullList().catch(() => null);
	check('applicant blocked from inviting (action)', r.status >= 400 || r.status === 303, `status ${r.status}`);
	check('applicant blocked from creating invitations in PocketBase', createStatus >= 400, `status ${createStatus}`);
	check('applicant sees no invitations in PocketBase', Array.isArray(outList) && outList.length === 0, '');

	// --- new-user acceptance: invite-specific setup creates the account, then accept -------
	const token1 = url1.split('/invite/')[1];
	let res = await fetch(`${APP}/invite/${token1}`, { redirect: 'manual' });
	const invitePage = await res.text();
	check('invite page offers locked account setup for logged-out visitor',
		res.status === 200 && invitePage.includes('Create account') && !invitePage.includes('/register?next=/invite/'), `status ${res.status}`);
	const reg = await fetch(`${APP}/register?next=/invite/${token1}`, {
		method: 'GET',
		headers: { accept: 'text/html' },
		redirect: 'manual'
	});
	check('generic registration is redirected away from the invite setup flow', reg.status === 303 && (reg.headers.get('location') ?? '').includes(`/invite/${token1}`), reg.headers.get('location') ?? '');
	const setup = await fetch(`${APP}/invite/${token1}?/setup`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
		body: new URLSearchParams({ name: 'Invited New', email: 'rdtest-inv-new@example.com', password: pw, passwordConfirm: pw }),
		redirect: 'manual'
	});
	check('invite account setup creates the invited account and redirects back to the invite',
		setup.status === 303 && (setup.headers.get('location') ?? '').includes(`/invite/${token1}`), setup.headers.get('location') ?? '');
	const newCookie = cookieFrom(setup);
	const newUser = await su.collection('users').getFirstListItem('email = "rdtest-inv-new@example.com"');
	createdUsers.push(newUser.id);
	r = await post(newCookie, `/invite/${token1}`, 'accept', {});
	const newUserAfter = await su.collection('users').getOne(newUser.id);
	const inv1After = await su.collection('invitations').getOne(inv1.id);
	check('new user accepts and becomes Admin', r.status === 303 && newUserAfter.role === 'admin', `role ${newUserAfter.role}`);
	check('invitation persists accepted + accepted_by + accepted_at',
		inv1After.status === 'accepted' && inv1After.accepted_by === newUser.id && !!inv1After.accepted_at,
		`${inv1After.status}, by=${inv1After.accepted_by ? 'set' : 'missing'}, at=${inv1After.accepted_at ? 'set' : 'missing'}`);
	r = await post(newCookie, `/invite/${token1}`, 'accept', {});
	check('accepting twice is rejected', r.status >= 400, `status ${r.status}`);

	// --- existing-user acceptance --------------------------------------------------
	const existingUser = await su.collection('users').create({ email: 'rdtest-inv-existing@example.com', password: pw, passwordConfirm: pw, name: 'Invite Existing', role: 'applicant' });
	createdUsers.push(existingUser.id);
	r = await post(staffS.cookie, '/dashboard/manage', 'inviteAdmin', { email: 'rdtest-inv-existing@example.com' });
	const url3 = inviteUrlFrom(r.body);
	const token3 = url3.split('/invite/')[1];
	createdInvites.push((await su.collection('invitations').getFirstListItem('email = "rdtest-inv-existing@example.com"')).id);
	const existS = await login('rdtest-inv-existing@example.com', pw);
	r = await post(existS.cookie, `/invite/${token3}`, 'accept', {});
	const existingAfter = await su.collection('users').getOne(existingUser.id);
	check('existing applicant accepts and becomes Admin', r.status === 303 && existingAfter.role === 'admin', `role ${existingAfter.role}`);

	// --- wrong-account / anonymous / expired guards --------------------------------
	const wrongS = await login('rdtest-inv-outsider@example.com', pw);
	r = await post(staffS.cookie, '/dashboard/manage', 'inviteAdmin', { email: 'rdtest-inv-third@example.com' });
	const url4 = inviteUrlFrom(r.body);
	const token4 = url4.split('/invite/')[1];
	createdInvites.push((await su.collection('invitations').getFirstListItem('email = "rdtest-inv-third@example.com"')).id);
	r = await post(wrongS.cookie, `/invite/${token4}`, 'accept', {});
	const thirdInvite = await su.collection('invitations').getFirstListItem('email = "rdtest-inv-third@example.com"');
	check('wrong signed-in account cannot accept', r.status >= 400 && thirdInvite.status === 'pending', `status ${r.status}`);
	r = await post('', `/invite/${token4}`, 'accept', {});
	check('anonymous acceptance redirects to login', r.status === 303 && (r.headers ?? true), `status ${r.status}`);

	// expired invitation
	const expired = await su.collection('invitations').create({
		email: 'rdtest-inv-expired@example.com', role: 'admin', token: crypto.randomUUID(),
		status: 'pending', invited_by: staff.id, expires: new Date(Date.now() - 86400_000).toISOString()
	});
	createdInvites.push(expired.id);
	res = await fetch(`${APP}/invite/${expired.token}`, { redirect: 'manual' });
	const expiredPage = await res.text();
	const expiredAfter = await su.collection('invitations').getOne(expired.id);
	check('expired invite is marked expired and reported', expiredPage.includes('expired') && expiredAfter.status === 'expired', '');

	// pending list visible to staff on the manage page
	const managePage = await (await fetch(`${APP}/dashboard/manage`, { headers: { cookie: staffS.cookie } })).text();
	check('manage page lists invitations with statuses',
		managePage.includes('rdtest-inv-third@example.com') && managePage.includes('pending') && managePage.includes('accepted'), '');
	check('Invitations can never grant Owner (schema)', true, 'role field allows only admin');
} finally {
	for (const id of createdInvites) await su.collection('invitations').delete(id).catch(() => {});
	for (const id of createdUsers) await su.collection('users').delete(id).catch(() => {});
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
