/**
 * One-off schema migration: add the protected multi-image `photos` field to
 * maintenance_requests. Idempotent — exits without changes when the field
 * already exists. Rules and existing fields are preserved untouched.
 *
 * Limits mirror the client: JPEG/PNG/WebP only, up to 6 photos, 5 MB each.
 * `protected: true` means file downloads require a PocketBase file token; the
 * app serves them through /files/maintenance_requests/... which mints the
 * token with the signed-in user's own permissions (owner tenant or staff).
 *
 * Usage: node --env-file=.env scripts/add-maintenance-photos.mjs
 */
import PocketBase from 'pocketbase';

const url = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
const email = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const password = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;

if (!email || !password) {
	console.error('Missing PRIVATE_POCKETBASE_SUPERUSER_EMAIL / _PASSWORD in env.');
	process.exit(1);
}

const pb = new PocketBase(url);
pb.autoCancellation(false);

try {
	await pb.collection('_superusers').authWithPassword(email, password);
} catch {
	await pb.admins.authWithPassword(email, password);
}
console.log('Superuser auth: OK');

const collection = await pb.collections.getOne('maintenance_requests');
const fields = collection.fields ?? collection.schema ?? [];

if (fields.some((f) => f.name === 'photos')) {
	const existing = fields.find((f) => f.name === 'photos');
	console.log('photos field already exists:', JSON.stringify(existing));
	process.exit(0);
}

fields.push({
	name: 'photos',
	type: 'file',
	required: false,
	maxSelect: 6,
	maxSize: 5242880, // 5 MB per photo
	protected: true,
	mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
	thumbs: ['100x100', '300x300', '1024x1024']
});

await pb.collections.update(collection.id, { fields });
console.log('Added photos field (file, maxSelect 6, 5 MB, JPEG/PNG/WebP, protected).');
console.log('maintenance_requests fields now:', fields.map((f) => f.name).join(', '));
