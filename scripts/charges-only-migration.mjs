#!/usr/bin/env node
/**
 * RentalDesk — charges-only schema migration.
 *
 * Scope:
 *   Adds only the missing boolean fields on the target collection:
 *     - preview_visible
 *     - amount_pending
 *
 * Safety:
 *   - Dry run by default. No writes unless --apply is set.
 *   - Uses collection metadata, never charge records, to inspect schema.
 *   - Refuses to apply if an existing field with the same name has an incompatible type.
 *   - Refuses any non-localhost production target unless --apply --production is set.
 *   - Backup creation is intentionally separate from schema application; do not
 *     create or apply a backup inside this script.
 *
 * Usage:
 *   node --env-file=.env.test --env-file=.env.test.local scripts/charges-only-migration.mjs
 *   node --env-file=.env.test --env-file=.env.test.local scripts/charges-only-migration.mjs --apply
 *   node --env-file=.env scripts/charges-only-migration.mjs --apply --production
 */
import PocketBase from 'pocketbase';
import { pathToFileURL } from 'node:url';

export const REQUIRED_FIELDS = [
  { name: 'preview_visible', type: 'bool' },
  { name: 'amount_pending', type: 'bool' }
];

export function parseOptions(argv = process.argv.slice(2), env = process.env) {
  const APPLY = argv.includes('--apply');
  const PRODUCTION_OK = argv.includes('--production');
  const BACKUP_REQUESTED = argv.includes('--backup');
  const confirmHostFlag = argv.find((arg) => arg.startsWith('--confirm-host='));
  const TARGET_NAME = (() => {
    const flag = argv.find((arg) => arg.startsWith('--collection='));
    return flag ? flag.split('=')[1] : (env.MIGRATE_COLLECTION_NAME || 'charges');
  })();
  const confirmHost = confirmHostFlag ? confirmHostFlag.split('=')[1] : env.MIGRATE_CONFIRM_HOST;
  const url = env.MIGRATE_PB_URL || env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

  return { APPLY, PRODUCTION_OK, BACKUP_REQUESTED, TARGET_NAME, confirmHost, url };
}

export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'Missing target URL. Set MIGRATE_PB_URL or PUBLIC_POCKETBASE_URL.' };
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      return { ok: false, reason: `Invalid target URL: ${url}` };
    }
    return { ok: true, hostname: parsed.hostname, url: parsed.toString() };
  } catch {
    return { ok: false, reason: `Invalid target URL: ${url}` };
  }
}

export function validateTargetSettings({ url, apply, productionOk, targetName, confirmHost, backupRequested, allowLocalProbe = true }) {
  if (backupRequested) {
    return { ok: false, reason: 'Refusing: --backup is not allowed in this script.' };
  }

  const parse = validateUrl(url);
  if (!parse.ok) return parse;

  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(parse.hostname);
  if (apply && !isLocal) {
    if (!productionOk) {
      return { ok: false, reason: `Refusing to write to non-local target: ${url}. Re-run with --apply --production and the exact --confirm-host=${parse.hostname}.` };
    }
    if (targetName !== 'charges') {
      return { ok: false, reason: `Non-local writes are restricted to the charges collection. Got: ${targetName}` };
    }
    if (!confirmHost || confirmHost !== parse.hostname) {
      return { ok: false, reason: `Exact hostname confirmation required for non-local writes. Use --confirm-host=${parse.hostname}.` };
    }
  }

  if (allowLocalProbe && !isLocal && !apply) {
    return { ok: true, hostname: parse.hostname, url: parse.url };
  }

  return { ok: true, hostname: parse.hostname, url: parse.url };
}

export function detectFieldKey(collection) {
  if (Array.isArray(collection?.fields)) return 'fields';
  if (Array.isArray(collection?.schema)) return 'schema';
  return null;
}

export function normalizeFieldList(collection) {
  const key = detectFieldKey(collection);
  if (!key) {
    throw new Error(`Collection "${collection?.name ?? '<unknown>'}" has neither a valid fields array nor a valid schema array.`);
  }
  return { key, fields: collection[key] };
}

export function buildPlan(collection, requiredFields = REQUIRED_FIELDS) {
  const { key, fields } = normalizeFieldList(collection);
  const existing = new Map((fields || []).map((field) => [field.name, field]));
  const conflicts = [];
  const missing = [];

  for (const field of requiredFields) {
    const existingField = existing.get(field.name);
    if (!existingField) {
      missing.push(field);
      continue;
    }
    if (existingField.type !== field.type) {
      conflicts.push({
        name: field.name,
        existingType: existingField.type,
        requiredType: field.type,
        existingField
      });
    }
  }

  return { key, fields, missing, conflicts, hasChanges: missing.length > 0 };
}

export async function main(argv = process.argv) {
  const options = parseOptions(argv.slice(2), process.env);
  const targetValidation = validateTargetSettings({
    url: options.url,
    apply: options.APPLY,
    productionOk: options.PRODUCTION_OK,
    targetName: options.TARGET_NAME,
    confirmHost: options.confirmHost,
    backupRequested: options.BACKUP_REQUESTED
  });
  if (!targetValidation.ok) {
    console.error(targetValidation.reason);
    process.exit(1);
  }

  const adminEmail = process.env.PB_ADMIN_EMAIL || process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD || process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error('Missing PocketBase admin credentials. Set PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD or the PRIVATE_POCKETBASE_SUPERUSER_* equivalents.');
    process.exit(1);
  }

  const pb = new PocketBase(options.url);
  pb.autoCancellation(false);

  try {
    await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
  } catch {
    try {
      await pb.admins.authWithPassword(adminEmail, adminPassword);
    } catch (err) {
      console.error('PocketBase admin authentication failed.');
      console.error(err?.response ? JSON.stringify(err.response, null, 2) : err?.message || String(err));
      process.exit(1);
    }
  }

  console.log(`target: ${options.url}  collection: ${options.TARGET_NAME}  mode: ${options.APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);

  const collections = await pb.collections.getFullList();
  const current = collections.find((c) => c.name === options.TARGET_NAME);
  if (!current) {
    console.error(`Collection "${options.TARGET_NAME}" was not found.`);
    process.exit(1);
  }

  let plan;
  try {
    plan = buildPlan(current, REQUIRED_FIELDS);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (plan.conflicts.length > 0) {
    console.error('Refusing to apply: existing field type mismatch in target collection metadata.');
    for (const conflict of plan.conflicts) {
      console.error(`  - ${conflict.name}: found ${conflict.existingType}, required ${conflict.requiredType}`);
    }
    process.exit(1);
  }

  if (plan.missing.length === 0) {
    console.log('No changes needed: both required fields are already present on the target collection metadata.');
    return;
  }

  console.log('PLAN:');
  for (const field of plan.missing) {
    console.log(`  ADD FIELD ${field.name} (${field.type})`);
  }

  if (!options.APPLY) {
    console.log(`\nDry run complete — ${plan.missing.length} field addition(s) would be made. Re-run with --apply to execute.`);
    return;
  }

  const updateKey = plan.key;
  const updatedFields = [...(plan.fields || []), ...plan.missing];
  await pb.collections.update(current.id, {
    [updateKey]: updatedFields
  });

  console.log(`\nApplied: ${plan.missing.length} field addition(s) to collection "${options.TARGET_NAME}".`);
  console.log('No unrelated collections, rules, indexes, or records were touched.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
