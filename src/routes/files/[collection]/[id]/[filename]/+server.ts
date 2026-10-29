import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_POCKETBASE_URL } from '$lib/files';

/**
 * Document downloads go through this route so every file URL carries a fresh,
 * short-lived PocketBase file token minted with the signed-in user's own
 * permissions. PocketBase enforces the record's viewRule when the token is
 * presented, so other users' private uploads stay inaccessible.
 */
export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Sign in required.');
	const collection = event.params.collection;
	if (collection !== 'documents' && collection !== 'inspections') error(404, 'Not found.');

	const token = await event.locals.pb.files.getToken();
	// Optional PocketBase thumbnail (only for image files; validated format).
	const thumb = event.url.searchParams.get('thumb');
	const thumbParam = thumb && /^\d{1,4}x\d{1,4}$/.test(thumb) ? `&thumb=${thumb}` : '';
	const target =
		`${PUBLIC_POCKETBASE_URL}/api/files/${collection}/` +
		`${encodeURIComponent(event.params.id)}/${encodeURIComponent(event.params.filename)}` +
		`?token=${encodeURIComponent(token)}${thumbParam}`;
	// SvelteKit blocks external redirects unless the origin is allowlisted.
	redirect(302, target, { external: [new URL(PUBLIC_POCKETBASE_URL).origin] });
};
