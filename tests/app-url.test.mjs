/**
 * Unit tests for the fail-closed app-base-URL helper (database-free).
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	appBaseUrl,
	AppUrlConfigError,
	isExplicitProduction,
	PRODUCTION_APP_URL
} from '../src/lib/server/app-url.ts';

const FORWARDED = 'https://hallowed-cobweb-97p96p656xpc9xqx-5174.app.github.dev';

test('local/test: missing PUBLIC_APP_URL throws a clear configuration error', () => {
	assert.throws(() => appBaseUrl(undefined, { production: false }), AppUrlConfigError);
	assert.throws(() => appBaseUrl(undefined, { production: false }), /PUBLIC_APP_URL is not configured/);
	assert.throws(() => appBaseUrl('   ', { production: false }), AppUrlConfigError);
});

test('local/test: invalid PUBLIC_APP_URL throws (never silently production)', () => {
	for (const bad of ['not-a-url', 'ftp://example.com', 'http://evil.example.com', 'https://example.com/some/path']) {
		assert.throws(() => appBaseUrl(bad, { production: false }), AppUrlConfigError, bad);
	}
});

test('valid forwarded dev URL returns its origin', () => {
	assert.equal(appBaseUrl(FORWARDED, { production: false }), FORWARDED);
	assert.equal(appBaseUrl(`${FORWARDED}/`, { production: false }), FORWARDED); // trailing slash normalized
	assert.equal(appBaseUrl('http://localhost:5174', { production: false }), 'http://localhost:5174');
});

test('production: missing falls back to the production URL only when explicitly identified', () => {
	assert.equal(appBaseUrl(undefined, { production: true }), PRODUCTION_APP_URL);
});

test('production: invalid configured value still throws', () => {
	assert.throws(() => appBaseUrl('not-a-url', { production: true }), AppUrlConfigError);
});

test('production: a valid configured URL wins over the fallback', () => {
	assert.equal(appBaseUrl('https://staging.example.com', { production: true }), 'https://staging.example.com');
});

test('isExplicitProduction requires explicit markers', () => {
	assert.equal(isExplicitProduction({}), false);
	assert.equal(isExplicitProduction({ APP_ENV: 'production' }), true);
	assert.equal(isExplicitProduction({ NETLIFY: 'true', CONTEXT: 'production' }), true);
	assert.equal(isExplicitProduction({ NETLIFY: 'true', CONTEXT: 'deploy-preview' }), false);
	assert.equal(isExplicitProduction({ APP_ENV: 'development' }), false);
});
