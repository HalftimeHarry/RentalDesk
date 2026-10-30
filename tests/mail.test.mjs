/**
 * Unit tests for the email safeguards (database-free, no network).
 * The whole point: during tests, email is disabled by default and only the
 * allowlisted owner address can ever receive anything.
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	MailBlockedError,
	allowedRecipients,
	assertAllowedRecipients,
	configuredTestRecipient,
	isEmailEnabled,
	sendMail
} from '../src/lib/server/mail.ts';

const OWNER = 'mail-test@example.com';

function env(over = {}) {
	return {
		PRIVATE_EMAIL_ENABLED: 'true',
		RESEND_API_KEY: 're_test_key',
		EMAIL_TEST_TO: OWNER,
		...over
	};
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

test('configured test recipient is the only allowed address', () => {
	assert.equal(configuredTestRecipient(env()), OWNER);
	assert.deepEqual([...allowedRecipients(env())], [OWNER]);
	assert.equal(configuredTestRecipient(env({ EMAIL_TEST_TO: `  ${OWNER.toUpperCase()}  ` })), OWNER);
	assert.deepEqual([...allowedRecipients(env({ EMAIL_TEST_TO: '' }))], []);
	assert.deepEqual([...allowedRecipients(env({ EMAIL_TEST_TO: 'not-an-email' }))], []);
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

test('configured recipient passes; case and whitespace normalized', async () => {
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

test('missing or invalid EMAIL_TEST_TO fails closed before the network', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await assert.rejects(
			sendMail({ to: OWNER, subject: 's', text: 't' }, env({ EMAIL_TEST_TO: '' })),
			MailBlockedError
		);
		await assert.rejects(
			sendMail({ to: OWNER, subject: 's', text: 't' }, env({ EMAIL_TEST_TO: 'not-an-email' })),
			MailBlockedError
		);
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('any non-configured To is blocked before the network', async () => {
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
	assert.throws(() => assertAllowedRecipients({ to: [] }, env()), MailBlockedError);
	assert.throws(() => assertAllowedRecipients({ to: '  ' }, env()), MailBlockedError);
});

test('malformed CC or BCC rejects before network calls', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await assert.rejects(
			sendMail({ to: OWNER, cc: 'not-an-email', subject: 's', text: 't' }, env()),
			MailBlockedError
		);
		await assert.rejects(
			sendMail({ to: OWNER, bcc: '  ', subject: 's', text: 't' }, env()),
			MailBlockedError
		);
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('blank recipient entry rejects before network calls', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await assert.rejects(
			sendMail({ to: [OWNER, '  '], subject: 's', text: 't' }, env()),
			MailBlockedError
		);
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('empty To with an allowed CC still rejects', async () => {
	const { calls, stub } = spyFetch();
	const realFetch = globalThis.fetch;
	globalThis.fetch = stub;
	try {
		await assert.rejects(
			sendMail({ to: '', cc: OWNER, subject: 's', text: 't' }, env()),
			MailBlockedError
		);
		assert.equal(calls.length, 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test('missing API key is a config error, not a send', async () => {
	await assert.rejects(
		sendMail({ to: OWNER, subject: 's', text: 't' }, env({ RESEND_API_KEY: undefined })),
		/RESEND_API_KEY/
	);
});
