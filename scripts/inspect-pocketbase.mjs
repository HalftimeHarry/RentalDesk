/**
 * Read-only inspection of the target PocketBase instance.
 * Prints version + collection/rule overview. Never prints credentials.
 *
 * Usage: node --env-file=.env scripts/inspect-pocketbase.mjs
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
console.log('URL:', url);

const health = await fetch(`${url}/api/health`).then((r) => r.json()).catch(() => null);
console.log('Version:', health?.version ?? '(unknown)');

const collections = await pb.collections.getFullList();
console.log(`\nCollections (${collections.length}):`);
for (const c of collections.sort((a, b) => a.name.localeCompare(b.name))) {
	const fields = c.fields ?? c.schema ?? [];
	console.log(`- ${c.name} (${c.type})  fields: [${fields.map((f) => f.name).join(', ')}]`);
	console.log(
		`  rules  list:${c.listRule === null ? 'locked' : JSON.stringify(c.listRule)} view:${c.viewRule === null ? 'locked' : JSON.stringify(c.viewRule)}`
	);
	console.log(
		`         create:${c.createRule === null ? 'locked' : JSON.stringify(c.createRule)} update:${c.updateRule === null ? 'locked' : JSON.stringify(c.updateRule)} delete:${c.deleteRule === null ? 'locked' : JSON.stringify(c.deleteRule)}`
	);
}
