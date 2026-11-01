import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  detectFieldKey,
  normalizeFieldList,
  parseOptions,
  validateTargetSettings,
  REQUIRED_FIELDS
} from '../scripts/charges-only-migration.mjs';

test('detectFieldKey prefers fields metadata and falls back to schema', () => {
  assert.equal(detectFieldKey({ fields: [{ name: 'x', type: 'text' }] }), 'fields');
  assert.equal(detectFieldKey({ schema: [{ name: 'x', type: 'text' }] }), 'schema');
  assert.equal(detectFieldKey({ name: 'charges' }), null);
});

test('normalizeFieldList refuses a collection with neither valid fields nor schema array', () => {
  assert.throws(() => normalizeFieldList({ name: 'charges', fields: {} }), /neither a valid fields array nor a valid schema array/i);
});

test('buildPlan catches conflicting types and preserves metadata when already present', () => {
  const alreadyOK = {
    name: 'charges',
    fields: [
      { name: 'description', type: 'text' },
      { name: 'preview_visible', type: 'bool' },
      { name: 'amount_pending', type: 'bool' }
    ]
  };
  const plan = buildPlan(alreadyOK, REQUIRED_FIELDS);
  assert.equal(plan.hasChanges, false);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.conflicts, []);

  const conflict = {
    name: 'charges',
    fields: [{ name: 'preview_visible', type: 'text' }]
  };
  const conflicted = buildPlan(conflict, REQUIRED_FIELDS);
  assert.equal(conflicted.hasChanges, true);
  assert.equal(conflicted.conflicts.length, 1);
  assert.equal(conflicted.conflicts[0].name, 'preview_visible');
});

test('parseOptions rejects backup and keeps local probe support', () => {
  const opts = parseOptions(['--apply', '--collection=charges_migration_probe', '--backup'], { MIGRATE_COLLECTION_NAME: 'charges' });
  assert.equal(opts.BACKUP_REQUESTED, true);
  assert.equal(opts.TARGET_NAME, 'charges_migration_probe');
});

test('validateTargetSettings rejects nonlocal writes without exact hostname confirmation and exact collection', () => {
  const missingConfirmation = validateTargetSettings({
    url: 'https://example.com',
    apply: true,
    productionOk: true,
    targetName: 'charges',
    confirmHost: 'other.example.com',
    backupRequested: false
  });
  assert.equal(missingConfirmation.ok, false);
  assert.match(missingConfirmation.reason, /Exact hostname confirmation required/i);

  const wrongCollection = validateTargetSettings({
    url: 'https://example.com',
    apply: true,
    productionOk: true,
    targetName: 'leases',
    confirmHost: 'example.com',
    backupRequested: false
  });
  assert.equal(wrongCollection.ok, false);
  assert.match(wrongCollection.reason, /charges collection/i);

  const localProbe = validateTargetSettings({
    url: 'http://127.0.0.1:8090',
    apply: true,
    productionOk: false,
    targetName: 'charges_migration_probe',
    confirmHost: '',
    backupRequested: false
  });
  assert.equal(localProbe.ok, true);
});

test('validateTargetSettings rejects invalid URL before auth', () => {
  const bad = validateTargetSettings({
    url: 'not a url',
    apply: true,
    productionOk: true,
    targetName: 'charges',
    confirmHost: 'localhost',
    backupRequested: false
  });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /Invalid target URL/i);
});
