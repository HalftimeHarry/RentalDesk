/**
 * Unit tests for the development-only PocketBase target guard (database-free).
 *
 * Proves:
 *  - the isolated local instance (http://127.0.0.1:8090) is accepted in dev
 *  - every other target is rejected in dev with a clear error and no override
 *  - the guard is a no-op outside development (production builds / Netlify)
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	assertDevPocketBaseTarget,
	DEV_POCKETBASE_URL,
	PocketBaseDevTargetError
} from '../src/lib/pocketbase-dev-guard.ts';

test('dev: the local test instance is accepted', () => {
	assert.doesNotThrow(() => assertDevPocketBaseTarget('http://127.0.0.1:8090', true));
	assert.doesNotThrow(() => assertDevPocketBaseTarget(DEV_POCKETBASE_URL, true));
	// Cosmetic variations of the same target are tolerated.
	assert.doesNotThrow(() => assertDevPocketBaseTarget(' http://127.0.0.1:8090 ', true));
	assert.doesNotThrow(() => assertDevPocketBaseTarget('http://127.0.0.1:8090/', true));
});

test('dev: the production host is rejected with a clear error', () => {
	const production = 'https://pocketbase-railway-production-f446.up.railway.app';
	assert.throws(() => assertDevPocketBaseTarget(production, true), PocketBaseDevTargetError);
	assert.throws(() => assertDevPocketBaseTarget(production, true), /only http:\/\/127\.0\.0\.1:8090 is permitted/);
	// The error names the offending host but never echoes a full URL or secrets.
	assert.throws(
		() => assertDevPocketBaseTarget(`${production}/api`, true),
		/pocketbase-railway-production-f446\.up\.railway\.app/
	);
});

test('dev: every other nonlocal or malformed target is rejected', () => {
	for (const url of [
		'http://localhost:8090', // only the canonical 127.0.0.1 form is permitted
		'http://127.0.0.1:8091', // wrong port
		'https://127.0.0.1:8090', // wrong protocol
		'http://192.168.1.20:8090',
		'https://example.com',
		'not a url',
		'',
		undefined
	]) {
		assert.throws(
			() => assertDevPocketBaseTarget(url, true),
			PocketBaseDevTargetError,
			`expected rejection for ${JSON.stringify(url)}`
		);
	}
});

test('dev: there is no environment-variable override', () => {
	const production = 'https://pocketbase-railway-production-f446.up.railway.app';
	process.env.POCKETBASE_TEST_INSTANCE_CONFIRMED = 'pocketbase-railway-production-f446.up.railway.app';
	try {
		assert.throws(() => assertDevPocketBaseTarget(production, true), PocketBaseDevTargetError);
	} finally {
		delete process.env.POCKETBASE_TEST_INSTANCE_CONFIRMED;
	}
});

test('outside development the guard is inactive for any target', () => {
	assert.doesNotThrow(() => assertDevPocketBaseTarget('http://127.0.0.1:8090', false));
	assert.doesNotThrow(() =>
		assertDevPocketBaseTarget('https://pocketbase-railway-production-f446.up.railway.app', false)
	);
	assert.doesNotThrow(() => assertDevPocketBaseTarget(undefined, false));
	assert.doesNotThrow(() => assertDevPocketBaseTarget('', false));
});
