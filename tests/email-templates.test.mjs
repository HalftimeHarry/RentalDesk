/**
 * Unit tests for the email templates (database-free, no network).
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	EMAIL_APP_URL,
	escapeHtml,
	inviteAdminEmail,
	newMessageEmail,
	paymentRecordedEmail,
	previewEmails,
	renderEmail,
	statementReadyEmail
} from '../src/lib/server/email-templates.ts';

test('dynamic content is HTML-escaped', () => {
	const r = renderEmail('s', {
		preheader: '',
		greeting: 'Hi <script>alert(1)</script>,',
		heading: 'X <img onerror=x>',
		paragraphs: ['Body with "quotes" & <tags>'],
		items: [{ label: 'A<b>', value: '1&2' }],
		action: { label: 'Go', url: 'https://example.com/?a=1&b=2' }
	});
	assert.ok(!r.html.includes('<script>alert(1)</script>'));
	assert.ok(r.html.includes('&lt;script&gt;'));
	assert.ok(r.html.includes('&amp;'));
	assert.ok(r.html.includes('&quot;'));
	// plain text carries the raw content untouched (no HTML context)
	assert.ok(r.text.includes('Hi <script>alert(1)</script>,'));
});

test('layout has white content area, light-green header, ocean button, navy text, footer', () => {
	const r = renderEmail('s', {
		preheader: 'p',
		greeting: 'Hi A,',
		heading: 'H',
		paragraphs: ['x'],
		action: { label: 'Go', url: 'https://example.com' }
	});
	assert.ok(r.html.includes('background-color:#ffffff')); // white content card
	assert.ok(r.html.includes('background-color:#e2f2ee')); // light green header
	assert.ok(r.html.includes('background-color:#075985')); // ocean-blue button
	assert.ok(r.html.includes('color:#16324f')); // navy text
	assert.ok(r.html.includes('Dustin Dinsmore · Rental Desk'));
	assert.ok(r.html.includes('secure dashboard'));
});

test('payment recorded: itemized amount, date, method, reference, charge — in both versions', () => {
	const r = paymentRecordedEmail({
		name: 'Alex Rivera',
		amountCents: 100000,
		date: '2026-10-30',
		method: 'Check',
		reference: 'CHK-1001',
		charge: 'Rent — November 2026'
	});
	for (const s of ['$1,000.00', 'Oct 30, 2026', 'Check', 'CHK-1001', 'Rent — November 2026']) {
		assert.ok(r.html.includes(s), `html missing ${s}`);
		assert.ok(r.text.includes(s), `text missing ${s}`);
	}
	assert.ok(r.html.includes('We’ve recorded your payment.'));
	assert.ok(r.text.includes('We’ve recorded your payment.'));
	assert.ok(!r.html.includes('A payment was recorded on your account'));
	assert.equal(r.subject, 'Payment recorded — $1,000.00');
});

test('payment without reference omits the reference row', () => {
	const r = paymentRecordedEmail({
		name: 'A', amountCents: 7333, date: '2026-10-30', method: 'Zelle', reference: '', charge: 'Prorated rent'
	});
	assert.ok(!r.html.includes('Reference'));
});

test('statement ready: month + balance due, links to the production dashboard', () => {
	const r = statementReadyEmail({ name: 'Alex', month: 'November 2026', totalDueCents: 220000 });
	assert.equal(r.subject, 'Your November 2026 statement is ready');
	assert.ok(r.html.includes('$2,200.00'));
	assert.ok(r.html.includes(`${EMAIL_APP_URL}/dashboard/tenant`));
});

test('message notification links to dashboard and never includes message contents', () => {
	const r = newMessageEmail({ name: 'Alex' });
	assert.ok(r.html.includes(`${EMAIL_APP_URL}/dashboard`));
	assert.ok(r.text.includes(`${EMAIL_APP_URL}/dashboard`));
	assert.ok(r.text.includes('not included in email'));
});

test('plain-text versions contain no HTML tags', () => {
	for (const p of previewEmails()) {
		assert.ok(!/<[a-z]+[ >]/i.test(p.text), `${p.id} text contains a tag`);
	}
});

test('four fictional previews exist with distinct subjects', () => {
	const previews = previewEmails();
	assert.deepEqual(previews.map((p) => p.id), ['statement', 'payment', 'message', 'invite']);
	assert.equal(new Set(previews.map((p) => p.subject)).size, 4);
});

test('invite email: inviter, purpose, pilot, accurate admin permissions, expiry, button', () => {
	const r = inviteAdminEmail({
		inviterName: 'Dana Kim',
		url: 'https://example.com/invite/abc',
		expires: '2026-11-06T12:00:00.000Z'
	});
	assert.equal(r.subject, 'Dana Kim invited you to Rental Desk');
	for (const s of [
		'Dana Kim',
		'lease documents',
		'maintenance',
		'inspections',
		'move-out',
		'clear communication',
		'six-month pilot',
		'invite other admins',
		'roles stays with the Owner',
		'expires on Nov 6, 2026',
		'Accept admin invitation'
	]) {
		assert.ok(r.html.includes(s), `html missing: ${s}`);
		assert.ok(r.text.includes(s), `text missing: ${s}`);
	}
	assert.ok(r.html.includes('https://example.com/invite/abc'));
	// no speculative commercial claims
	assert.ok(!/customers|subscription|sales/i.test(r.text));
});

test('invite email escapes the inviter name', () => {
	const r = inviteAdminEmail({ inviterName: '<b>Dana</b>', url: 'https://example.com/invite/x', expires: '2026-11-06' });
	assert.ok(r.html.includes('&lt;b&gt;Dana&lt;/b&gt;'));
	assert.ok(!r.html.includes('<b>Dana</b>'));
});

test('escapeHtml neutralizes all five risky characters', () => {
	assert.equal(escapeHtml(`<a href="x">&'</`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/');
});
