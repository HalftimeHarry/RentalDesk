import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PUBLIC_POCKETBASE_URL } from '$lib/files';

/**
 * Document downloads are PROXIED through this route (never redirected) so the
 * PocketBase file URL and token stay server-side. The server mints a
 * short-lived file token with the signed-in user's own permissions and fetches
 * the file itself — PocketBase enforces the record's viewRule on that fetch,
 * so other users' private uploads come back 404 and are relayed as such.
 * Anonymous requests are rejected here before any PocketBase call.
 *
 * Proxying matters because the hosted PocketBase build serves protected files
 * without a token when the stored path is known; keeping the URL hidden and
 * always fetching with a user-scoped token is what enforces access control.
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

	const upstream = await fetch(target);
	if (!upstream.ok) {
		// Relay PocketBase's decision (404 when the viewRule rejects this user).
		error(upstream.status === 403 ? 403 : 404, 'File not available.');
	}

	const filename = event.params.filename;
	const safeName = filename.replace(/[^\w.-]+/g, '_');
	const disposition =
		event.url.searchParams.get('download') === '1'
			? `attachment; filename="${safeName}"`
			: (upstream.headers.get('content-disposition') ?? `inline; filename="${safeName}"`);

	return new Response(upstream.body, {
		status: 200,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
			'content-disposition': disposition,
			...(upstream.headers.get('content-length')
				? { 'content-length': upstream.headers.get('content-length')! }
				: {}),
			'cache-control': 'private, no-store'
		}
	});
};
