/**
 * Browser-driven verification of the INDIVIDUAL-charge payment workflow.
 * A real Chromium (Playwright) clicks through the actual forms with JS enabled
 * against the ISOLATED test stack only:
 *   app        http://localhost:5174  (dev server bound to local PocketBase)
 *   PocketBase http://127.0.0.1:8090  (throwaway local instance)
 * The target guard refuses the production host; the APP URL must be localhost.
 *
 * Fixtures (rdtest-* users, one lease, four published charges) are created and
 * removed by exact id via superuser; all PAYMENTS are recorded through the UI.
 * Screenshots are saved to /tmp/pwt/.
 *
 * Prerequisites:
 *   /tmp/pb-test/pocketbase serve --http=127.0.0.1:8090 --dir /tmp/pb-test/pb_data
 *   PUBLIC_POCKETBASE_URL=http://127.0.0.1:8090 npm run dev -- --port 5174
 *
 * Usage: node --env-file=.env.test --env-file=.env.test.local scripts/verify-charge-payments.browser.mjs
 */
import { mkdir } from 'node:fs/promises';
import PocketBase from 'pocketbase';
import { chromium } from 'playwright';
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
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP)) {
	console.error(`REFUSED — APP_URL must be a local dev server, got ${APP}`);
	process.exit(1);
}

const SHOTS = '/tmp/pwt';
await mkdir(SHOTS, { recursive: true });

const REF = 'CHK-1001';
const pw = `Rd!${Math.random().toString(36).slice(2)}uI7`;
const adminEmail = 'rdtest-ui-admin@example.com';
const tenantEmail = 'rdtest-ui-tenant@example.com';

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
	if (!ok) failed++;
};

// --- fixtures -----------------------------------------------------------------
const su = new PocketBase(PB);
su.autoCancellation(false);
await su.collection('_superusers').authWithPassword(suEmail, suPassword);

const admin = await su.collection('users').create({ email: adminEmail, password: pw, passwordConfirm: pw, name: 'UI Test Admin', role: 'admin' });
const tenant = await su.collection('users').create({ email: tenantEmail, password: pw, passwordConfirm: pw, name: 'UI Test Tenant', role: 'tenant' });
const lease = await su.collection('leases').create({
	tenant: tenant.id,
	start_date: '2026-10-30',
	end_date: '2027-10-29',
	monthly_rent_cents: 220000,
	deposit_cents: 100000,
	status: 'active'
});
const mkCharge = (data) =>
	su.collection('charges').create({ lease: lease.id, period: '', prorated: false, status: 'published', ...data });
const octRent = await mkCharge({ period: '2026-10', type: 'rent', description: 'Prorated rent — October 2026', amount_cents: 7333, due_date: '2026-10-30', prorated: true });
const novRent = await mkCharge({ period: '2026-11', type: 'rent', description: 'Rent — November 2026', amount_cents: 220000, due_date: '2026-11-01' });
const deposit = await mkCharge({ type: 'deposit', description: 'Security deposit', amount_cents: 100000, due_date: '2026-10-30' });
const credit = await mkCharge({ type: 'other', description: 'Credit check fee', amount_cents: 7000, due_date: '2026-10-30' });

const paymentsFor = (chargeId) =>
	su.collection('payments').getFullList({ filter: `charge = "${chargeId}"`, sort: 'created' });

// --- browser helpers -----------------------------------------------------------
const browser = await chromium.launch();

async function newSession(viewport) {
	const context = await browser.newContext({ viewport });
	const page = await context.newPage();
	page.setDefaultTimeout(30000); // dev server compiles routes on first hit
	return { context, page };
}

async function login(page, email) {
	await page.goto(`${APP}/login`);
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(pw);
	await page.getByRole('button', { name: 'Log in' }).click();
	await page.waitForURL('**/dashboard/**');
	await page.waitForLoadState('networkidle');
}

/** Navigate and wait until hydration has settled (dev server compiles on first hit). */
async function gotoSettled(page, path) {
	await page.goto(`${APP}${path}`);
	await page.waitForLoadState('networkidle');
}

/** Open the Record payment dialog for a charge row (simple view). Retries the
 *  click — a click that lands before Svelte hydration finishes is a no-op. */
async function openPaymentDialog(page, description) {
	const row = page.locator('li', { hasText: description }).first();
	const dialog = page.locator('[role="dialog"]');
	for (let attempt = 0; attempt < 4; attempt++) {
		await row.getByRole('button', { name: 'Record payment' }).click();
		try {
			await dialog.waitFor({ state: 'visible', timeout: 3000 });
			return dialog;
		} catch { /* not hydrated yet — retry */ }
	}
	await dialog.waitFor({ state: 'visible' }); // final attempt with full timeout
	return dialog;
}

async function pickCheck(dialog) {
	await dialog.locator('#rp-method').click();
	await dialog.page().getByRole('option', { name: 'Check' }).click();
}

async function submitDialog(dialog) {
	await dialog.getByRole('button', { name: 'Record payment', exact: true }).click();
}

const simpleRow = (page, description) => page.locator('li', { hasText: description }).first();
const detailedRow = (page, description) =>
	page.locator('.divide-y.overflow-hidden > div', { hasText: description }).first();

try {
	// ============================= desktop admin =============================
	const { context: adminCtx, page } = await newSession({ width: 1366, height: 900 });

	// Wrong password must still show the credentials error (not a backend error).
	await page.goto(`${APP}/login`);
	await page.locator('input[name="email"]').fill(adminEmail);
	await page.locator('input[name="password"]').fill('definitely-wrong');
	await page.getByRole('button', { name: 'Log in' }).click();
	await page.getByText('Invalid email or password.').waitFor();
	check('bad password shows "Invalid email or password"', page.url().includes('/login'), '');

	await login(page, adminEmail);
	check('admin login redirects to dashboard', page.url().includes('/dashboard/manage'), page.url());
	await gotoSettled(page, '/dashboard/manage/billing');
	await page.getByText('Rent — November 2026').first().waitFor();

	// ---- 7. invalid amounts: validation + preserved values -------------------
	let dialog = await openPaymentDialog(page, 'Rent — November 2026');
	check('dialog shows remaining $2,200.00 on November rent',
		(await dialog.getByText('Remaining on this charge:').count()) > 0 &&
		(await dialog.getByText('$2,200.00').count()) > 0, '');

	await dialog.locator('#rp-amount').fill('abc');
	await dialog.locator('#rp-reference').fill(REF);
	await submitDialog(dialog);
	const errEl = dialog.locator('p.text-destructive');
	await errEl.waitFor({ state: 'visible' });
	const err1 = await errEl.innerText();
	const amountAfter1 = await dialog.locator('#rp-amount').inputValue();
	const refAfter1 = await dialog.locator('#rp-reference').inputValue();
	check('invalid amount "abc" shows validation error', /amount and date are required/i.test(err1), err1);
	check('entered values preserved after failed submit', amountAfter1 === 'abc' && refAfter1 === REF,
		`amount="${amountAfter1}" ref="${refAfter1}"`);
	await page.screenshot({ path: `${SHOTS}/03-invalid-amount.png` });

	await dialog.locator('#rp-amount').fill('9999.00');
	await submitDialog(dialog);
	await errEl.waitFor({ state: 'visible' });
	const err2 = await errEl.innerText();
	check('overpayment shows remaining-balance error', /exceeds the remaining balance/i.test(err2), err2);
	check('overpayment value preserved', (await dialog.locator('#rp-amount').inputValue()) === '9999.00', '');

	// ---- 1 + 5. partial payment via double-clicked submit ---------------------
	await dialog.locator('#rp-amount').fill('1000.00');
	await pickCheck(dialog);
	const submitBtn = dialog.getByRole('button', { name: 'Record payment', exact: true });
	await submitBtn.dblclick(); // double-click must not double-save
	await dialog.waitFor({ state: 'hidden' });
	const novAfterP1 = await paymentsFor(novRent.id);
	const p1 = novAfterP1.filter((p) => p.amount_cents === 100000);
	check('1) dialog closed after successful $1,000 payment', novAfterP1.length === 1 && p1.length === 1,
		`${novAfterP1.length} payment(s) on November rent`);
	check('5) double-click saved exactly one payment', novAfterP1.length === 1,
		`payments: ${novAfterP1.map((p) => p.amount_cents).join(', ') || 'none'}`);
	check('1) payment carries charge/lease/reference/recorded_by',
		p1.length === 1 && p1[0].charge === novRent.id && p1[0].lease === lease.id && p1[0].reference === REF && p1[0].recorded_by === admin.id && p1[0].method === 'check', '');

	await simpleRow(page, 'Rent — November 2026').getByText('$1,200.00').waitFor();
	check('1) November rent row shows $1,200.00 remaining', true, 'simple view');

	await page.getByRole('button', { name: 'Detailed' }).click();
	const novDetailed = detailedRow(page, 'Rent — November 2026');
	await novDetailed.getByText('Partially paid').waitFor();
	check('1) November rent shows Partially paid badge', true, 'detailed view');
	await page.screenshot({ path: `${SHOTS}/01-partial-paid-detailed.png` });

	// ---- 6. duplicate rejection with visible error -----------------------------
	await page.getByRole('button', { name: 'Simple' }).click();
	dialog = await openPaymentDialog(page, 'Rent — November 2026');
	await dialog.locator('#rp-amount').fill('1000.00'); // identical to the payment just made
	await pickCheck(dialog);
	await dialog.locator('#rp-reference').fill(REF);
	await submitDialog(dialog);
	await errEl.waitFor({ state: 'visible' });
	const errDup = await errEl.innerText();
	check('6) identical payment rejected', /duplicate prevented/i.test(errDup), errDup);
	check('6) dialog stays open with the error visible', await dialog.isVisible(), '');
	await page.screenshot({ path: `${SHOTS}/02-duplicate-rejected.png` });
	check('6) no duplicate record created', (await paymentsFor(novRent.id)).length === 1, '');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await dialog.waitFor({ state: 'hidden' });

	// ---- 2. pay the remaining $1,200 -------------------------------------------
	dialog = await openPaymentDialog(page, 'Rent — November 2026');
	const prefill = await dialog.locator('#rp-amount').inputValue();
	check('2) amount prefilled with remaining balance', prefill === '1200.00', prefill);
	await pickCheck(dialog);
	await dialog.locator('#rp-reference').fill(REF);
	await submitDialog(dialog);
	await dialog.waitFor({ state: 'hidden' });
	const novAfterP2 = await paymentsFor(novRent.id);
	const novTotal = novAfterP2.reduce((s, p) => s + p.amount_cents, 0);
	check('2) November rent fully paid ($2,200.00)', novAfterP2.length === 2 && novTotal === 220000,
		`${novAfterP2.length} payments, ${(novTotal / 100).toFixed(2)}`);
	await page.getByRole('button', { name: 'Detailed' }).click();
	await novDetailed.getByText('Paid', { exact: true }).waitFor();
	check('2) November rent shows Paid badge', true, 'detailed view');
	await page.getByRole('button', { name: 'Simple' }).click();

	// ---- 9. mobile viewport dialog (while charges remain) ----------------------
	{
		const { context: mCtx, page: m } = await newSession({ width: 375, height: 812 });
		await login(m, adminEmail);
		await gotoSettled(m, '/dashboard/manage/billing');
		const mDialog = await openPaymentDialog(m, 'Security deposit');
		const dlgBox = await mDialog.boundingBox();
		const amountBox = await mDialog.locator('#rp-amount').boundingBox();
		const submitBox = await mDialog.getByRole('button', { name: 'Record payment', exact: true }).boundingBox();
		const cancelBox = await mDialog.getByRole('button', { name: 'Cancel' }).boundingBox();
		const within = (b) => b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 375 + 1 && b.y + b.height <= 812 + 1;
		check('9) mobile: amount, submit and cancel inside 375x812 viewport',
			!!amountBox && !!submitBox && !!cancelBox && within(amountBox) && within(submitBox) && within(cancelBox),
			`cancel bottom=${cancelBox ? Math.round(cancelBox.y + cancelBox.height) : 'n/a'} of 812`);
		check('9) mobile: dialog panel fits the viewport width (no horizontal bleed)',
			!!dlgBox && dlgBox.x >= 0 && dlgBox.x + dlgBox.width <= 375 + 1,
			dlgBox ? `panel right=${Math.round(dlgBox.x + dlgBox.width)} of 375` : 'no panel box');
		await m.screenshot({ path: `${SHOTS}/05-mobile-dialog.png` });
		await mCtx.close();
	}

	// ---- 3. deposit payment ------------------------------------------------------
	dialog = await openPaymentDialog(page, 'Security deposit');
	check('3) deposit amount prefilled at $1,000.00', (await dialog.locator('#rp-amount').inputValue()) === '1000.00', '');
	await pickCheck(dialog);
	await dialog.locator('#rp-reference').fill(REF);
	await submitDialog(dialog);
	await dialog.waitFor({ state: 'hidden' });
	const depPayments = await paymentsFor(deposit.id);
	check('3) deposit payment recorded with applies_to=deposit',
		depPayments.length === 1 && depPayments[0].amount_cents === 100000 && depPayments[0].applies_to === 'deposit', '');
	await page.getByText('Deposit fully received').waitFor();
	check('3) deposit tile shows fully received', true, '');
	check('3) total balance drops to $143.33 (Oct + credit-check remain)',
		(await page.getByText('$143.33').count()) > 0, '');

	// ---- 4. October rent + credit check, same reference --------------------------
	for (const [desc, cents] of [['Prorated rent — October 2026', 7333], ['Credit check fee', 7000]]) {
		dialog = await openPaymentDialog(page, desc);
		await pickCheck(dialog);
		await dialog.locator('#rp-reference').fill(REF);
		await submitDialog(dialog);
		await dialog.waitFor({ state: 'hidden' });
		const ps = await paymentsFor(desc.includes('October') ? octRent.id : credit.id);
		check(`4) ${desc} paid (${(cents / 100).toFixed(2)})`, ps.length === 1 && ps[0].amount_cents === cents && ps[0].reference === REF, '');
	}

	// ---- totals after all five payments ------------------------------------------
	const all = await su.collection('payments').getFullList({ filter: `lease = "${lease.id}"`, sort: 'created' });
	check('exactly 5 payments, all with reference CHK-1001',
		all.length === 5 && all.every((p) => p.reference === REF), `${all.length} payments`);
	check('4) reusing one check reference across charges is allowed', all.length === 5, 'no uniqueness conflict');
	check('total payments equal $3,343.33', all.reduce((s, p) => s + p.amount_cents, 0) === 334333, '');

	// The payments card rows each render "ref CHK-1001"; statement lines never show refs.
	await page.getByText('ref CHK-1001').first().waitFor();
	const refCount = await page.getByText('ref CHK-1001').count();
	check('admin payments list shows 5 entries with ref CHK-1001', refCount === 5, `${refCount} rows`);
	await page.getByText('$0.00').first().waitFor();
	check('admin total balance is $0.00', true, '');

	// ---- refresh persistence ------------------------------------------------------
	await page.reload();
	await page.waitForLoadState('networkidle');
	await page.getByText('Payments recorded').waitFor();
	const refsAfterReload = await page.getByText('ref CHK-1001').count();
	check('8) refresh: 5 payments and $0.00 balance persist',
		refsAfterReload === 5 && (await page.getByText('$0.00').count()) > 0, `${refsAfterReload} rows`);
	await page.screenshot({ path: `${SHOTS}/04-all-paid-admin.png`, fullPage: true });
	await adminCtx.close();

	// ============================= tenant view =====================================
	const { context: tCtx, page: t } = await newSession({ width: 1366, height: 900 });
	await login(t, tenantEmail);
	check('8) tenant login lands on tenant dashboard', t.url().includes('/dashboard/tenant'), t.url());
	// Fully settled accounts show the settled message rather than a $0 total row.
	await t.getByText('Account balance').waitFor();
	check('8) tenant balance section reports all published charges settled',
		(await t.getByText(/Nothing due — all published charges are settled/).count()) > 0, '');

	const tRows = t.locator('tbody tr');
	await tRows.first().waitFor();
	const tRowTexts = await tRows.allInnerTexts();
	check('8) tenant payment history lists all 5 payments', tRowTexts.length === 5, `${tRowTexts.length} rows`);
	check('8) history shows $1,000.00 x2, $1,200.00, $73.33, $70.00 — all Check',
		tRowTexts.filter((x) => x.includes('$1,000.00')).length === 2 &&
		tRowTexts.some((x) => x.includes('$1,200.00')) &&
		tRowTexts.some((x) => x.includes('$73.33')) &&
		tRowTexts.some((x) => x.includes('$70.00')) &&
		tRowTexts.every((x) => x.includes('Check')), '');
	check('8) exactly one row applies to Deposit', tRowTexts.filter((x) => x.includes('Deposit')).length === 1, '');
	await t.screenshot({ path: `${SHOTS}/06-tenant-dashboard.png`, fullPage: true });

	await t.getByText('November 2026 statement').waitFor();
	await t.getByText('October 2026 statement').waitFor();
	// The charged/paid/remaining line is split across text nodes — compare the
	// normalized full page text instead of a single element.
	const tBody = await t.locator('body').innerText();
	check('8) tenant November statement: charged/paid $2,200.00, remaining $0.00',
		tBody.includes('Charged $2,200.00 · paid $2,200.00 · remaining $0.00'), '');
	check('8) tenant October statement: charged/paid $73.33, remaining $0.00',
		tBody.includes('Charged $73.33 · paid $73.33 · remaining $0.00'), '');
	await t.screenshot({ path: `${SHOTS}/07-tenant-statements.png`, fullPage: true });
	await tCtx.close();
} catch (e) {
	failed++;
	console.error('FAIL  unexpected error:', e?.message ?? e);
	try { await browser.newPage(); } catch { /* browser already closed */ }
} finally {
	await browser.close().catch(() => {});
	// Cleanup by exact fixture ids; payments cascade with the lease.
	await su.collection('leases').delete(lease.id).catch(() => {});
	for (const id of [octRent.id, novRent.id, deposit.id, credit.id]) {
		await su.collection('charges').delete(id).catch(() => {});
	}
	const strays = await su.collection('payments').getFullList({ filter: `lease = "${lease.id}"` }).catch(() => []);
	for (const s of strays) await su.collection('payments').delete(s.id).catch(() => {});
	await su.collection('users').delete(tenant.id).catch(() => {});
	await su.collection('users').delete(admin.id).catch(() => {});
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
