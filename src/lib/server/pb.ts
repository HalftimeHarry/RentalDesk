import PocketBase from 'pocketbase';
import { POCKETBASE_URL } from '$lib/files';

/** Create a fresh PocketBase client (one per request on the server). */
export function createPocketBase(): PocketBase {
	return new PocketBase(POCKETBASE_URL);
}

/**
 * Superuser-authenticated client for server-side elevation only (e.g. invite
 * acceptance granting Admin). Same env-credential pattern as the scheduled
 * Netlify function. Server-only — never exposed to the browser.
 */
export async function createSuperuserClient(): Promise<PocketBase> {
	const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
	const email = env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
	const password = env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
	if (!email || !password) throw new Error('Superuser credentials are not configured.');
	const pb = createPocketBase();
	pb.autoCancellation(false);
	await pb.collection('_superusers').authWithPassword(email, password);
	return pb;
}
