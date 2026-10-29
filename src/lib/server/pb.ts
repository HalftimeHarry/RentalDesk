import PocketBase from 'pocketbase';
import { POCKETBASE_URL } from '$lib/files';

/** Create a fresh PocketBase client (one per request on the server). */
export function createPocketBase(): PocketBase {
	return new PocketBase(POCKETBASE_URL);
}
