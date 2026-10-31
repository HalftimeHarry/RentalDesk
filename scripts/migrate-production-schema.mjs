/**
 * RentalDesk — targeted schema migration for PR #3 + deployed code gaps.
 *
 * SCOPE (nothing else is touched):
 *   Creates, if missing:
 *     - help_videos               (PR #3 tutorials)
 *     - property_access           (PR #3 gate/lockbox codes, strict scoping)
 *     - invitations               (deployed admin-invitation flow)
 *     - inspection_private_notes  (deployed inspection saves 500 without it)
 *     - inspection_notifications  (deployed signed-inspection notification flow)
 *   Adds, if missing (append-only, never removes or alters existing fields):
 *     - inspections.archived  (bool)       — deployed inspection list/archive
 *     - inspections.final_pdf (file, protected) — deployed signing finalization;
 *       without it the second signature cannot be confirmed and notifications
 *       never trigger.
 *   For the five owned collections, rules are aligned to the tested versions;
 *   rules of every other collection are never touched. No records are read,
 *   written, or seeded. No accounts, leases, settings, payments, or codes.
 *
 * SAFETY:
 *   - DRY RUN by default: prints the exact plan, performs no writes.
 *   - `--apply` executes the plan. A non-localhost target ADDITIONALLY
 *     requires `--production` (explicit opt-in; refuses otherwise).
 *   - `--backup` (with --apply): creates a PocketBase backup first.
 *   - Idempotent: a second run reports "no changes needed".
 *
 * Usage:
 *   Dry run (local):   node --env-file=.env.test --env-file=.env.test.local scripts/migrate-production-schema.mjs
 *   Apply   (local):   node --env-file=.env.test --env-file=.env.test.local scripts/migrate-production-schema.mjs --apply
 *   Dry run (prod):    node --env-file=.env scripts/migrate-production-schema.mjs
 *   Apply   (prod):    node --env-file=.env scripts/migrate-production-schema.mjs --apply --production --backup
 *
 * Field/rule definitions are copied from scripts/setup-pocketbase.mjs — keep
 * them in sync when that file changes.
 */
import PocketBase from 'pocketbase';

const APPLY = process.argv.includes('--apply');
const PRODUCTION_OK = process.argv.includes('--production');
const BACKUP = process.argv.includes('--backup');

const url = process.env.MIGRATE_PB_URL || process.env.PUBLIC_POCKETBASE_URL;
const adminEmail = process.env.PB_ADMIN_EMAIL || process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const adminPassword = process.env.PB_ADMIN_PASSWORD || process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!url || !adminEmail || !adminPassword) {
	console.error('Missing env: PUBLIC_POCKETBASE_URL (or MIGRATE_PB_URL) and superuser credentials.');
	process.exit(1);
}

const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
if (APPLY && !isLocal && !PRODUCTION_OK) {
	console.error(`REFUSING: ${url} is not local. Re-run with BOTH --apply and --production to write to it.`);
	process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
console.log(`target: ${url}  mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);

const STAFF = '@request.auth.role = "owner" || @request.auth.role = "admin"';
const TIMESTAMPS = [
	{ name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

// Relation targets must already exist (they do in production).
const existing = await pb.collections.getFullList();
const byName = Object.fromEntries(existing.map((c) => [c.name, c]));
for (const required of ['users', 'inspections', 'leases', 'settings']) {
	if (!byName[required]) {
		console.error(`BLOCKER: required collection "${required}" is missing on the target — aborting.`);
		process.exit(1);
	}
}
const usersId = byName.users.id;
const inspectionsId = byName.inspections.id;

const HELP_VIDEO_RULE = `@request.auth.id != "" && active = true && (@request.auth.role = "admin" || @request.auth.role = "owner" || (audience = "tenant" && @request.auth.role = "tenant"))`;
const PROPERTY_ACCESS_RULE = `@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "owner" || (@request.auth.role = "tenant" && active = true && @collection.leases.tenant ?= @request.auth.id && @collection.leases.status ?= "active" && ((type = "gate" && property != "" && (@collection.settings.address ?= property || @collection.settings.unit_name ?= property)) || (type = "door_lockbox" && unit != "" && (@collection.settings.unit_name ?= unit || @collection.settings.address ?= unit)))))`;

const defs = [
	{
		name: 'help_videos',
		type: 'base',
		fields: [
			{ name: 'slug', type: 'text', required: true, max: 100 },
			{ name: 'title', type: 'text', required: true, max: 200 },
			{ name: 'description', type: 'text', max: 2000 },
			{ name: 'audience', type: 'select', required: true, maxSelect: 1, values: ['tenant', 'admin'] },
			{ name: 'placement', type: 'select', required: true, maxSelect: 1, values: ['tenant_dashboard', 'manage_dashboard', 'manage_billing'] },
			{ name: 'video_file', type: 'file', required: true, maxSelect: 1, maxSize: 25165824, protected: true, mimeTypes: ['video/mp4'] },
			{ name: 'thumbnail', type: 'file', required: true, maxSelect: 1, maxSize: 5242880, protected: true, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] },
			{ name: 'captions', type: 'file', required: true, maxSelect: 1, maxSize: 1048576, protected: true, mimeTypes: ['text/vtt', 'text/plain'] },
			{ name: 'active', type: 'bool' }
		],
		listRule: HELP_VIDEO_RULE,
		viewRule: HELP_VIDEO_RULE,
		createRule: STAFF,
		updateRule: STAFF,
		deleteRule: STAFF
	},
	{
		name: 'property_access',
		type: 'base',
		fields: [
			{ name: 'label', type: 'text', required: true, max: 200 },
			{ name: 'type', type: 'select', required: true, maxSelect: 1, values: ['gate', 'door_lockbox'] },
			{ name: 'property', type: 'text', max: 200 },
			{ name: 'unit', type: 'text', max: 100 },
			{ name: 'code', type: 'text', required: true, max: 200 },
			{ name: 'instructions', type: 'text', max: 1500 },
			{ name: 'active', type: 'bool' }
		],
		listRule: PROPERTY_ACCESS_RULE,
		viewRule: PROPERTY_ACCESS_RULE,
		createRule: STAFF,
		updateRule: STAFF,
		deleteRule: STAFF
	},
	{
		name: 'invitations',
		type: 'base',
		fields: [
			{ name: 'email', type: 'text', required: true, max: 200 },
			{ name: 'role', type: 'select', required: true, maxSelect: 1, values: ['admin'] },
			{ name: 'token', type: 'text', required: true, max: 64 },
			{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'accepted', 'expired'] },
			{ name: 'invited_by', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
			{ name: 'expires', type: 'date', required: true },
			{ name: 'accepted_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
			{ name: 'accepted_at', type: 'date' }
		],
		listRule: STAFF,
		viewRule: STAFF,
		createRule: STAFF,
		updateRule: null,
		deleteRule: STAFF
	},
	{
		name: 'inspection_private_notes',
		type: 'base',
		fields: [
			{ name: 'inspection', type: 'relation', required: true, collectionId: inspectionsId, maxSelect: 1, cascadeDelete: true },
			{ name: 'body', type: 'text', max: 5000 },
			{ name: 'created_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false }
		],
		listRule: STAFF,
		viewRule: STAFF,
		createRule: STAFF,
		updateRule: STAFF,
		deleteRule: STAFF
	},
	{
		name: 'inspection_notifications',
		type: 'base',
		fields: [
			{ name: 'inspection', type: 'relation', required: true, collectionId: inspectionsId, maxSelect: 1, cascadeDelete: true },
			{ name: 'recipient', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
			{ name: 'email', type: 'text', required: true, max: 200 },
			{ name: 'role', type: 'select', required: true, maxSelect: 1, values: ['landlord', 'tenant'] },
			{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'sent', 'failed'] },
			{ name: 'error', type: 'text', max: 500 },
			{ name: 'attempts', type: 'number', min: 0, onlyInt: true },
			{ name: 'sent_at', type: 'date' }
		],
		listRule: STAFF,
		viewRule: STAFF,
		createRule: STAFF,
		updateRule: STAFF,
		deleteRule: STAFF
	}
].map((d) => ({ ...d, fields: [...d.fields, ...TIMESTAMPS] }));

// Append-only field additions for an EXISTING collection (rules untouched).
const inspectionsFieldAdds = [
	{ name: 'archived', type: 'bool' },
	{ name: 'final_pdf', type: 'file', maxSelect: 1, maxSize: 10485760, protected: true, mimeTypes: ['application/pdf'] }
];

const plan = [];
for (const def of defs) {
	const current = byName[def.name];
	if (!current) {
		plan.push({ action: 'CREATE COLLECTION', name: def.name, run: () => pb.collections.create(def) });
		continue;
	}
	// Collection exists: append missing fields; align rules for OUR collections only.
	const have = new Set((current.fields || []).map((f) => f.name));
	const missingFields = def.fields.filter((f) => !have.has(f.name));
	const ruleKeys = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];
	const ruleChanges = ruleKeys.filter((k) => (current[k] ?? null) !== (def[k] ?? null));
	if (missingFields.length === 0 && ruleChanges.length === 0) {
		plan.push({ action: 'OK (no change)', name: def.name });
		continue;
	}
	plan.push({
		action: `UPDATE ${def.name}`,
		name: def.name,
		detail:
			(missingFields.length ? ` +fields: ${missingFields.map((f) => f.name).join(', ')}` : '') +
			(ruleChanges.length ? ` ~rules: ${ruleChanges.join(', ')}` : ''),
		run: () =>
			pb.collections.update(current.id, {
				fields: [...(current.fields || []), ...missingFields],
				...Object.fromEntries(ruleChanges.map((k) => [k, def[k] ?? null]))
			})
	});
}
{
	const insp = byName.inspections;
	const have = new Set((insp.fields || []).map((f) => f.name));
	const missing = inspectionsFieldAdds.filter((f) => !have.has(f.name));
	if (missing.length > 0) {
		plan.push({
			action: 'UPDATE inspections',
			name: 'inspections',
			detail: ` +fields: ${missing.map((f) => f.name).join(', ')} (append-only; rules and existing fields untouched)`,
			run: () => pb.collections.update(insp.id, { fields: [...(insp.fields || []), ...missing] })
		});
	} else {
		plan.push({ action: 'OK (no change)', name: 'inspections' });
	}
}

console.log('\nPLAN:');
for (const p of plan) console.log(`  ${p.action.padEnd(24)} ${p.name}${p.detail ?? ''}`);
const writes = plan.filter((p) => p.run);
if (writes.length === 0) {
	console.log('\nNo changes needed — target already matches.');
	process.exit(0);
}
if (!APPLY) {
	console.log(`\nDRY RUN complete — ${writes.length} change(s) WOULD be made. Re-run with --apply to execute.`);
	process.exit(0);
}

if (BACKUP) {
	const name = `pre-pr3-migration-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
	await pb.backups.create(name);
	console.log(`backup created: ${name}`);
}
for (const p of writes) {
	await p.run();
	console.log(`applied: ${p.action} ${p.name}${p.detail ?? ''}`);
}
console.log(`\nDone — ${writes.length} change(s) applied. Re-run without --apply to verify "no changes needed".`);
