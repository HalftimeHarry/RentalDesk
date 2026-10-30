/**
 * Unit tests for inspection-signed email confirmation + snapshot integrity
 * (database-free; PocketBase and fetch are stubbed).
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { namedTenants, notifySignedInspection, resolveRecipients } from '../src/lib/server/inspection-notify.ts';
import { signaturesCoverSnapshot, snapshotMatchesContent } from '../src/lib/inspection.ts';

const STAFF = { id: 'u-staff', email: 'staff@example.com', name: 'Staff Person' };
const TENANT = { id: 'u-tenant', email: 'tenant@example.com', name: 'Tenant Person' };

test('namedTenants splits on commas, "and", ampersands', () => {
	assert.deepEqual(namedTenants('Alex, Sam'), ['Alex', 'Sam']);
	assert.deepEqual(namedTenants('Alex and Sam'), ['Alex', 'Sam']);
	assert.deepEqual(namedTenants('Alex & Sam'), ['Alex', 'Sam']);
	assert.deepEqual(namedTenants('Alex'), ['Alex']);
	assert.deepEqual(namedTenants(''), []);
});

test('resolveRecipients: landlord from created_by, tenant from lease account', () => {
	const r = resolveRecipients({ createdBy: STAFF, tenantAccount: TENANT, tenantNames: 'Tenant Person' });
	assert.deepEqual(r.recipients.map((x) => x.email), ['staff@example.com', 'tenant@example.com']);
	assert.deepEqual(r.recipients.map((x) => x.role), ['landlord', 'tenant']);
	assert.equal(r.limitations.length, 0);
});

test('resolveRecipients: tenant_names is never mined for addresses', () => {
	const r = resolveRecipients({ createdBy: STAFF, tenantAccount: null, tenantNames: 'Tenant Person' });
	assert.deepEqual(r.recipients.map((x) => x.email), ['staff@example.com']);
	assert.ok(r.limitations.some((l) => l.includes('No tenant account')));
});

test('resolveRecipients: extra named tenants without accounts are a reported limitation', () => {
	const r = resolveRecipients({ createdBy: STAFF, tenantAccount: TENANT, tenantNames: 'Tenant Person, Roommate Person' });
	assert.equal(r.recipients.length, 2);
	assert.ok(r.limitations.some((l) => l.includes('1 other named tenant')));
});

test('resolveRecipients: landlord without email is a reported limitation', () => {
	const r = resolveRecipients({ createdBy: { id: 'x' }, tenantAccount: TENANT, tenantNames: 'T' });
	assert.deepEqual(r.recipients.map((x) => x.role), ['tenant']);
	assert.ok(r.limitations.some((l) => l.includes('landlord/manager')));
});

// ---- snapshot integrity -------------------------------------------------------

const baseInspection = {
	address: '1 Test Way', unit: '102', tenant_names: 'T', occupancy: 'occupied',
	move_in_date: '2026-10-01', move_out_date: '', date: '2026-10-01', type: 'move_in',
	notes: 'n', checklist: [], proposed_deductions: [],
	sig_landlord: 'sig-l.png', sig_landlord_name: 'Land', sig_landlord_at: '2026-10-30T10:00:00Z',
	sig_tenant: 'sig-t.png', sig_tenant_name: 'Ten', sig_tenant_at: '2026-10-30T10:05:00Z',
	signed_snapshot: null
};

test('signaturesCoverSnapshot requires both full signatures', () => {
	assert.ok(signaturesCoverSnapshot(baseInspection));
	assert.ok(!signaturesCoverSnapshot({ ...baseInspection, sig_tenant: '' }));
	assert.ok(!signaturesCoverSnapshot({ ...baseInspection, sig_landlord_at: '' }));
});

test('snapshotMatchesContent detects drift and accepts a matching snapshot', () => {
	const snapshot = {
		address: '1 Test Way', unit: '102', tenant_names: 'T', occupancy: 'occupied',
		move_in_date: '2026-10-01', move_out_date: '', date: '2026-10-01', type: 'move_in',
		notes: 'n', checklist: [], proposed_deductions: [], signed_completed_at: '2026-10-30T10:06:00Z'
	};
	assert.ok(snapshotMatchesContent({ ...baseInspection, signed_snapshot: snapshot }));
	assert.ok(!snapshotMatchesContent({ ...baseInspection, signed_snapshot: snapshot, notes: 'edited later' }));
	assert.ok(!signaturesCoverSnapshot({ ...baseInspection, signed_snapshot: snapshot, notes: 'edited later' }));
});

// ---- delivery tracking ----------------------------------------------------------

/** In-memory PocketBase stub: delivery rows + narrow user/lease lookups. */
function stubPb(existing = []) {
	const rows = [...existing];
	let nextId = 1;
	const users = new Map([[STAFF.id, { email: STAFF.email }], [TENANT.id, { email: TENANT.email }]]);
	return {
		rows,
		collection(name) {
			if (name === 'users') return { getOne: async (id) => users.get(id) ?? null };
			if (name === 'leases') return { getOne: async () => ({ tenant: TENANT.id }) };
			return {
				getFirstListItem: async (filter) => {
					const email = /email = "([^"]+)"/.exec(filter)?.[1];
					const row = rows.find((r) => r.email === email);
					if (!row) { const e = new Error('nf'); e.status = 404; throw e; }
					return row;
				},
				getFullList: async ({ filter } = {}) => rows.filter((r) => !filter?.includes('status != "sent"') || r.status !== 'sent'),
				getOne: async (id) => rows.find((r) => r.id === id),
				create: async (data) => { const row = { id: `n${nextId++}`, ...data }; rows.push(row); return row; },
				update: async (id, data) => { Object.assign(rows.find((r) => r.id === id), data); }
			};
		}
	};
}

const inspection = {
	id: 'insp1', address: '1 Test Way', unit: '102', type: 'move_in', date: '2026-10-01',
	created_by: STAFF.id, lease: 'lease1',
	sig_tenant_at: '2026-10-30T10:05:00Z', sig_landlord_at: '2026-10-30T10:00:00Z',
	tenant_names: 'Tenant Person',
	expand: { created_by: STAFF, lease: { tenant: TENANT.id, expand: { tenant: TENANT } } }
};

test('email disabled: delivery rows are created and stay pending (mocked email, no network)', async () => {
	const pb = stubPb();
	const result = await notifySignedInspection(pb, inspection, 'https://app.example');
	assert.equal(result.pending, 2);
	assert.equal(result.failed, 0);
	assert.equal(pb.rows.length, 2);
	assert.deepEqual(pb.rows.map((r) => [r.role, r.status]), [['landlord', 'pending'], ['tenant', 'pending']]);
});

test('rerun is idempotent — no duplicate rows', async () => {
	const pb = stubPb();
	await notifySignedInspection(pb, inspection, 'https://app.example');
	await notifySignedInspection(pb, inspection, 'https://app.example');
	assert.equal(pb.rows.length, 2);
});

test('a sent row is never resent on retry', async () => {
	const pb = stubPb([{ id: 'n1', inspection: 'insp1', email: 'staff@example.com', role: 'landlord', status: 'sent', attempts: 1, sent_at: '2026-10-30' }]);
	await notifySignedInspection(pb, inspection, 'https://app.example');
	const sent = pb.rows.find((r) => r.status === 'sent');
	assert.equal(sent.attempts, 1); // untouched
});

test('recipientsPreview exposes names only — never emails', async () => {
	const { recipientsPreview } = await import('../src/lib/server/inspection-notify.ts');
	const p = recipientsPreview({ landlordName: 'Staff Person', tenantName: 'Tenant Person', tenantNames: 'Tenant Person, Roommate Extra' });
	assert.deepEqual(p.recipients, [
		{ role: 'landlord', name: 'Staff Person' },
		{ role: 'tenant', name: 'Tenant Person' }
	]);
	assert.ok(!JSON.stringify(p).includes('@')); // no email leaks into the preview
	assert.ok(p.limitations.some((l) => l.includes('other named tenant')));
	const noTenant = recipientsPreview({ landlordName: 'Staff Person', tenantName: null, tenantNames: 'T' });
	assert.ok(noTenant.limitations.some((l) => l.includes('No tenant account')));
});
