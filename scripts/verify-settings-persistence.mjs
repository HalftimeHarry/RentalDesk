/**
 * End-to-end verification that unit settings persist through the real app:
 * login -> POST the settings form -> reload -> fresh login -> public listing.
 * Uses a temporary admin account (created/removed via superuser; credentials
 * are never printed). Requires the dev server on localhost:5173.
 *
 * Usage: node --env-file=.env scripts/verify-settings-persistence.mjs
 */
import PocketBase from 'pocketbase';

const PB = process.env.PUBLIC_POCKETBASE_URL;
const APP = process.env.APP_URL || 'http://localhost:5173';
const pw = `Rd!${Math.random().toString(36).slice(2)}vQ7`;
const email = 'rdtest-settings@example.com';

const su = new PocketBase(PB);
su.autoCancellation(false);
await su
	.collection('_superusers')
	.authWithPassword(process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL, process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD);

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

async function login() {
	const res = await fetch(`${APP}/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
		body: new URLSearchParams({ email, password: pw }),
		redirect: 'manual'
	});
	return { status: res.status, cookie: cookieFrom(res) };
}

async function saveSettings(cookie, fields) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const res = await fetch(`${APP}/dashboard/manage?/updateSettings`, {
		method: 'POST',
		headers: { cookie, accept: 'text/html' },
		body: fd,
		redirect: 'manual'
	});
	return res.status;
}

const admin = await su.collection('users').create({
	email, password: pw, passwordConfirm: pw, name: 'Settings Test Admin', role: 'admin'
});

// Capture current settings so the run leaves them untouched.
const original = await su
	.collection('settings')
	.getList(1, 1, { sort: 'created' })
	.then((l) => (l.items.length > 0 ? l.items[0] : null));

try {
	// 1. login through the app
	const s1 = await login();
	check('login through the app', (s1.status === 303 || s1.status === 302) && s1.cookie.includes('pb_auth='), `status ${s1.status}`);

	// 2. save settings (is_available deliberately absent -> false)
	const unique = `Seaside Verification Loft ${Date.now() % 100000}`;
	const st = await saveSettings(s1.cookie, {
		unit_name: unique,
		description: 'Persistence check',
		address: '1 Test Way',
		monthly_rent: '2350.75',
		deposit: '750',
		min_lease_months: '4',
		available_date: '2026-03-01'
	});
	check('settings form POST accepted', st === 200 || st === 303, `status ${st}`);

	// 3. manage page reload shows saved values (form inputs repopulated)
	const manage = await fetch(`${APP}/dashboard/manage`, { headers: { cookie: s1.cookie } }).then((r) => r.text());
	check('manage reload shows saved unit name', manage.includes(unique));
	check('manage reload shows saved rent', manage.includes('2350.75'));
	check('manage reload preserves is_available=false (checkbox unchecked)', !/name="is_available"[^>]*checked/.test(manage));

	// 4. public listing reflects the save
	const landing = await fetch(`${APP}/`).then((r) => r.text());
	check('public listing shows saved unit name', landing.includes(unique));
	check('public listing shows saved rent', landing.includes('$2,350.75'));
	check('public listing shows not-available badge', landing.includes('Not currently available'));

	// 5. fresh login (new session) still sees the saved values
	const s2 = await login();
	const manage2 = await fetch(`${APP}/dashboard/manage`, { headers: { cookie: s2.cookie } }).then((r) => r.text());
	check('fresh login still shows saved unit name', manage2.includes(unique));

	// 6. checkbox true persists too
	await saveSettings(s2.cookie, {
		unit_name: unique, description: 'Persistence check', address: '1 Test Way',
		monthly_rent: '2350.75', deposit: '750', min_lease_months: '4',
		available_date: '2026-03-01', is_available: 'on'
	});
	const landing2 = await fetch(`${APP}/`).then((r) => r.text());
	check('is_available=true appears on public listing', landing2.includes('>Available<') || landing2.includes('Available now') || landing2.includes('Available'));

	// 7. exactly one settings record on the server
	const all = await su.collection('settings').getFullList();
	check('exactly one settings record exists', all.length === 1, `found ${all.length}`);
	check('server record matches saved values', all[0]?.unit_name === unique && all[0]?.monthly_rent_cents === 235075 && all[0]?.is_available === true);
} finally {
	// restore pre-test settings values
	if (original) {
		await su.collection('settings').update(original.id, {
			unit_name: original.unit_name,
			description: original.description,
			address: original.address,
			monthly_rent_cents: original.monthly_rent_cents,
			deposit_cents: original.deposit_cents,
			min_lease_months: original.min_lease_months,
			available_date: original.available_date,
			is_available: original.is_available
		}).catch(() => {});
	}
	await su.collection('users').delete(admin.id).catch(() => {});
	// remove the leftover account from manual curl debugging, if present
	const stray = await su.collection('users').getFirstListItem('email = "rdtest-curl@example.com"').catch(() => null);
	if (stray) await su.collection('users').delete(stray.id).catch(() => {});
	console.log('\nTemporary admin account removed.');
}

console.log(failed === 0 ? '\nAll settings-persistence checks passed.' : `\n${failed} check(s) FAILED.`);
if (failed > 0) process.exit(1);
