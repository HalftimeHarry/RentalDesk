import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTenantInviteLink } from '../src/lib/server/invitations.ts';

test('tenant invite link creates an applicant signup URL without any tenant grant', () => {
	const url = buildTenantInviteLink('https://example.com', 'Tenant@Example.com');
	const parsed = new URL(url);
	assert.equal(parsed.origin, 'https://example.com');
	assert.equal(parsed.pathname, '/register');
	assert.equal(parsed.searchParams.get('email'), 'tenant@example.com');
	assert.equal(parsed.searchParams.get('tenantInvite'), '1');
	assert.equal(parsed.searchParams.get('next'), '/dashboard/applicant');
	assert.equal(parsed.searchParams.get('role'), null);
	assert.ok(!url.includes('role=tenant'));
	assert.ok(!url.includes('activateLease'));
});

test('tenant invite link rejects invalid emails before generating a URL', () => {
	assert.throws(() => buildTenantInviteLink('https://example.com', 'bad-email'), /valid email address/i);
});
