/**
 * Unit tests for the email safeguards (database-free, no network).
 * The whole point: during tests, email is disabled by default and only the
 * allowlisted owner address can ever receive anything.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	EMAIL_ALLOWLIST,
	MailBlockedError,
	allowedRecipients,
	assertAllowedRecipients,
	isEmailEnabled,
	sendMail
} from '../src/lib/server/mail.ts';

const OWNER = 'ddinsmore8@gmail.com';

function env(over = {}) {
	return { PRIVATE_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test_key', ...over };
}

/** Stub fetch that records calls; returns a fake 200. */
function spyFetch() {
	const calls = [];
	const stub = async (url, init) => {
		calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
		return new Response('{"id":"test"}', { status: 200 });
	};
	return { calls, stub };
}

test('allowlist contains only the owner test address', () => {
	assert.deepEqual([...allowedRecipients()], [OWNER]);
	assert.equal(EMAIL_ALLOWLIST.length, 1);
});

test('email is disabled unless explicitly enabled', () => {
	assert.equal(isEmailEnabled({}), false);
	assert.equal(isEmailEnabled({ PRIVATE_EMAIL_ENABLED: 'false' }), false);
	assert.equal(isEmailEnabled({ PRIVATE_EMAIL_ENABLED: '1' }), false);
	assert.equal(isEmailEnabled({ PRIVATE_EMAIL_ENABLED: 'true' }), true);
});

test('disabled email never touches the network', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		const r = await sendMail({ to: OWNER, subject: 's', text: 't' }, { PRIVATE_EMAIL_ENABLED: '' });
		assert.equal(r.sent, false);
		assert.equal(r.reason, 'email-disabled');
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('allowlisted recipient passes; case and whitespace normalized', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		const r = await sendMail({ to: `  ${OWNER.toUpperCase()} `, subject: 's', text: 't' }, env());
		assert.equal(r.sent, true);
		assert.equal(r.id, 'test');
		assert.equal(calls.length, 1);
		assert.equal(calls[0].body.to[0], OWNER);
		assert.ok(!calls[0].body.cc);
		assert.ok(!calls[0].body.bcc);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('any non-allowlisted To is blocked before the network', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await assert.rejects(
			sendMail({ to: 'tenant@example.com', subject: 's', text: 't' }, env()),
			(err) => err instanceof MailBlockedError && !err.message.includes('tenant@example.com')
		);
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('CC and BCC are equally restricted, even when To is allowed', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await assert.rejects(
			sendMail({ to: OWNER, cc: 'isaac@example.com', subject: 's', text: 't' }, env()),
			MailBlockedError
		);
		await assert.rejects(
			sendMail({ to: OWNER, bcc: ['anyone@example.com'], subject: 's', text: 't' }, env()),
			MailBlockedError
		);
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('empty recipient list is blocked', () => {
	assert.throws(() => assertAllowedRecipients({ to: [] }), MailBlockedError);
	assert.throws(() => assertAllowedRecipients({ to: '  ' }), MailBlockedError);
});

test('missing API key is a config error, not a send', async () => {
	await assert.rejects(
		sendMail({ to: OWNER, subject: 's', text: 't' }, { PRIVATE_EMAIL_ENABLED: 'true' }),
		/RESEND_API_KEY/
	);
});
