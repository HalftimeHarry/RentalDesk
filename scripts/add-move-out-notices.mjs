/**
 * One-off schema migration: create the move_out_notices collection.
 * Idempotent — exits without changes when it already exists.
 *
 * Design notes:
 *  - Tenants can only CREATE their own notice (and never update — corrections
 *    are new records linked via `supersedes`, so submitted versions persist).
 *  - `notice_pdf` is a protected file: downloads flow through the app's
 *    /files/move_out_notices/... proxy with the user's own permissions.
 *  - `client_token` makes the submit action idempotent (double-click safe).
 *
 * Usage: node --env-file=.env scripts/add-move-out-notices.mjs
 */
import PocketBase from 'pocketbase';

const url = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const email = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;

if (!email || !password) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD in env.');
	process.exit(1);
}

const STAFF = '@request.auth.role = "owner" || @request.auth.role = "admin"';

const pb = new PocketBase(url);
pb.autoCancellation(false);
try {
	await pb.collection('_superusers').authWithPassword(email, password);
} catch {
	await pb.admins.authWithPassword(email, password);
}
console.log('Superuser auth: OK');

const usersId = (await pb.collections.getOne('users')).id;
const leasesId = (await pb.collections.getOne('leases')).id;

let collection = await pb.collections.getOne('move_out_notices').catch(() => null);

if (!collection) {
	collection = await pb.collections.create({
		name: 'move_out_notices',
		type: 'base',
		fields: [
			{ name: 'lease', type: 'relation', required: true, collectionId: leasesId, maxSelect: 1, cascadeDelete: false },
			{ name: 'tenant', type: 'relation', required: true, collectionId: usersId, maxSelect: 1, cascadeDelete: false },
			{ name: 'tenant_names', type: 'text', required: true, max: 300 },
			{ name: 'property_address', type: 'text', required: true, max: 300 },
			{ name: 'unit', type: 'text', max: 50 },
			{ name: 'requested_date', type: 'date', required: true },
			{ name: 'forwarding_address', type: 'text', max: 300 },
			{ name: 'notes', type: 'text', max: 2000 },
			{ name: 'signer_name', type: 'text', required: true, max: 200 },
			{ name: 'submitted_at', type: 'date', required: true }, // server timestamp
			{ name: 'notice_pdf', type: 'file', maxSelect: 1, maxSize: 2097152, protected: true, mimeTypes: ['application/pdf'] },
			{ name: 'status', type: 'select', required: true, maxSelect: 1, values: ['submitted', 'acknowledged'] },
			{ name: 'acknowledged_at', type: 'date' },
			{ name: 'acknowledged_by', type: 'relation', collectionId: usersId, maxSelect: 1, cascadeDelete: false },
			// Recorded separately from requested_date — the requested date is never
			// treated as approved; nothing here ends the lease or changes rent.
			{ name: 'agreed_termination_date', type: 'date' },
			{ name: 'client_token', type: 'text', max: 64 }
		],
		listRule: `tenant = @request.auth.id || ${STAFF}`,
		viewRule: `tenant = @request.auth.id || ${STAFF}`,
		createRule: '@request.auth.role = "tenant" && @request.body.tenant = @request.auth.id',
		updateRule: STAFF,
		deleteRule: STAFF
	});
	console.log('Created move_out_notices.');
} else {
	console.log('move_out_notices already exists.');
}

// Self-relation must be added after the collection exists (PocketBase validates
// relation targets against existing collections at create time).
const fields = collection.fields ?? [];
if (!fields.some((f) => f.name === 'supersedes')) {
	fields.push({
		name: 'supersedes',
		type: 'relation',
		collectionId: collection.id,
		maxSelect: 1,
		cascadeDelete: false
	});
	await pb.collections.update(collection.id, { fields });
	console.log('Added supersedes self-relation.');
}

// Match the other collections' autodate timestamps.
for (const ts of [
	{ name: 'created', onCreate: true, onUpdate: false },
	{ name: 'updated', onCreate: true, onUpdate: true }
]) {
	if (!fields.some((f) => f.name === ts.name)) {
		fields.push({ name: ts.name, type: 'autodate', onCreate: ts.onCreate, onUpdate: ts.onUpdate });
		await pb.collections.update(collection.id, { fields });
		console.log(`Added ${ts.name} autodate.`);
	}
}
console.log('Fields:', fields.map((f) => f.name).join(', '));
