import assert from 'node:assert/strict';
import PocketBase from 'pocketbase';
import { chromium } from 'playwright';
import { assertSafePocketBaseTarget } from './lib/pocketbase-target-guard.mjs';

const APP = process.env.APP_URL || 'http://localhost:5174';
const PB = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
assertSafePocketBaseTarget(PB);

const suEmail = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const suPassword = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
const testPassword = process.env.TEST_ACCOUNTS_PASSWORD;
if (!suEmail || !suPassword || !testPassword) {
	throw new Error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD or TEST_ACCOUNTS_PASSWORD.');
}

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function normalizeWhitespace(text) {
	return text.replace(/\s+/g, ' ').trim();
}

function extractBalanceDue(text) {
	const match = text.match(/Total balance due\s*\$([0-9,]+\.[0-9]{2})/i);
	return match ? `$${match[1]}` : null;
}

function extractSelectedMonthStatement(text) {
	const match = text.match(/November 2026\s*\$([0-9,]+\.[0-9]{2})\s*\$([0-9,]+\.[0-9]{2})\s*\$([0-9,]+\.[0-9]{2})/i);
	return match ? `November 2026 $${match[1]} $${match[2]} $${match[3]}` : null;
}

async function login(page, email, password) {
	await page.goto(`${APP}/login`);
	await page.locator('input[name="email"]').fill(email);
	await page.locator('input[name="password"]').fill(password);
	await page.getByRole('button', { name: 'Log in' }).click();
	await page.waitForURL('**/dashboard/**', { timeout: 30000 });
	await page.waitForLoadState('networkidle');
}

const pb = new PocketBase(PB);
pb.autoCancellation(false);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const created = {
	users: [],
	leases: [],
	charges: [],
	documents: []
};

try {
	await pb.collection('_superusers').authWithPassword(suEmail, suPassword);

	const makeUser = async (email, name, role) => {
		const existing = await pb.collection('users').getFirstListItem(`email = "${email}"`).catch(() => null);
		if (existing) return existing;
		const createdUser = await pb.collection('users').create({
			email,
			password: testPassword,
			passwordConfirm: testPassword,
			name,
			role
		});
		created.users.push(createdUser.id);
		return createdUser;
	};

	const owner = await makeUser(`rdtest-owner-${suffix}@example.test`, `Verify Owner ${suffix}`, 'owner');
	const tenant = await makeUser(`rdtest-tenant-${suffix}@example.test`, `Verify Tenant ${suffix}`, 'tenant');

	const makeLease = async (tenantId) => {
		const existing = await pb.collection('leases').getFirstListItem(`tenant = "${tenantId}" && status = "active"`).catch(() => null);
		if (existing) return existing;
		const lease = await pb.collection('leases').create({
			tenant: tenantId,
			start_date: '2026-10-01',
			end_date: '2027-09-30',
			monthly_rent_cents: 220000,
			deposit_cents: 100000,
			status: 'active'
		});
		created.leases.push(lease.id);
		return lease;
	};

	const lease = await makeLease(tenant.id);

	const makeCharge = async (data) => {
		const charge = await pb.collection('charges').create({
			lease: lease.id,
			period: data.period,
			type: data.type,
			description: data.description,
			amount_cents: data.amount_cents,
			due_date: data.due_date,
			period_start: data.period_start || '',
			period_end: data.period_end || '',
			prorated: data.prorated ?? false,
			status: data.status,
			preview_visible: data.preview_visible ?? false,
			amount_pending: data.amount_pending ?? false,
			publish_at: data.publish_at ?? '',
			calc: null
		});
		created.charges.push(charge.id);
		return charge;
	};

	const officialCharge = await makeCharge({
		lease: lease.id,
		type: 'rent',
		description: `Official verification charge ${suffix}`,
		amount_cents: 220000,
		due_date: '2026-11-01',
		period: '2026-11',
		period_start: '',
		period_end: '',
		prorated: false,
		status: 'published',
		preview_visible: false,
		amount_pending: false,
		publish_at: ''
	});

	const previewDescription = `Preview verification charge ${suffix}`;
	const previewCharge = await makeCharge({
		type: 'other',
		description: previewDescription,
		amount_cents: 15000,
		due_date: '2026-12-15',
		period: '2026-12',
		period_start: '',
		period_end: '',
		prorated: false,
		status: 'draft',
		preview_visible: false,
		amount_pending: false,
		publish_at: '2026-12-17T16:00:00.000Z'
	});

	const pdf = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF';
	const file = new File([pdf], `preview-${suffix}.pdf`, { type: 'application/pdf' });
	const formData = new FormData();
	formData.set('owner', owner.id);
	formData.set('kind', 'bill');
	formData.set('lease', lease.id);
	formData.set('charge', previewCharge.id);
	formData.set('title', `Draft bill attachment ${suffix}`);
	formData.set('file', file);
	const document = await pb.collection('documents').create(formData);
	created.documents.push(document.id);

	await login(page, tenant.email, testPassword);
	await page.goto(`${APP}/dashboard/tenant`);
	await page.waitForLoadState('networkidle');

	const beforeText = normalizeWhitespace(await page.locator('body').innerText());
	const beforeBalance = extractBalanceDue(beforeText);
	const beforeStatement = extractSelectedMonthStatement(beforeText);

	assert.ok(beforeBalance, `Expected official balance due text before preview. Body: ${beforeText.slice(0, 600)}`);
	assert.ok(beforeStatement, `Expected selected-month statement row before preview. Body: ${beforeText.slice(0, 600)}`);
	assert.ok(!beforeText.includes(previewDescription), `Preview should be hidden before enabling it. Body: ${beforeText.slice(0, 600)}`);

	await pb.collection('charges').update(previewCharge.id, { preview_visible: true });
	await page.reload();
	await page.waitForLoadState('networkidle');

	const afterText = normalizeWhitespace(await page.locator('body').innerText());
	const afterBalance = extractBalanceDue(afterText);
	const afterStatement = extractSelectedMonthStatement(afterText);

	assert.equal(afterBalance, beforeBalance, `Official balance changed after preview was enabled. before=${beforeBalance} after=${afterBalance}`);
	assert.equal(afterStatement, beforeStatement, `Official statement totals changed after preview was enabled. before=${beforeStatement} after=${afterStatement}`);
	assert.ok(afterText.includes(previewDescription), `Preview should appear after preview_visible=true. Body: ${afterText.slice(0, 800)}`);
	assert.ok(afterText.includes('Amounts may change until published.'), `Preview wording missing after enabling preview. Body: ${afterText.slice(0, 800)}`);

	const tenantPb = new PocketBase(PB);
	await tenantPb.collection('users').authWithPassword(tenant.email, testPassword);
	await assert.rejects(
		() => tenantPb.collection('charges').getOne(previewCharge.id),
		/(403|404|not allowed|forbidden|not found)/i,
		'Direct tenant read of a draft preview charge should be denied.'
	);
	await assert.rejects(
		() => tenantPb.collection('documents').getOne(document.id),
		/(403|404|not allowed|forbidden|not found)/i,
		'Direct tenant read of a draft-linked attachment should be denied.'
	);

	console.log('PASS official balance unchanged before/after preview enable');
	console.log(`PASS preview visible: ${previewDescription}`);
	console.log(`PASS balance before=${beforeBalance} after=${afterBalance}`);
	console.log(`PASS statement before=${beforeStatement} after=${afterStatement}`);
	console.log('PASS direct draft/file reads denied for tenant');
} finally {
	try {
		for (const docId of [...created.documents].reverse()) {
			await pb.collection('documents').delete(docId).catch(() => {});
		}
		for (const chargeId of [...created.charges].reverse()) {
			await pb.collection('charges').delete(chargeId).catch(() => {});
		}
		for (const leaseId of [...created.leases].reverse()) {
			await pb.collection('leases').delete(leaseId).catch(() => {});
		}
		for (const userId of [...created.users].reverse()) {
			await pb.collection('users').delete(userId).catch(() => {});
		}
	} finally {
		await browser.close();
	}
}
