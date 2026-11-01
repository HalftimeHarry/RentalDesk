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
	const allowed = ['documents', 'inspections', 'maintenance_requests', 'move_out_notices', 'help_videos'];
	if (!allowed.includes(collection)) {
		error(404, 'Not found.');
	}

	const token = await event.locals.pb.files.getToken();
	// Optional PocketBase thumbnail (only for image files; validated format).
	const thumb = event.url.searchParams.get('thumb');
	const thumbParam = thumb && /^\d{1,4}x\d{1,4}$/.test(thumb) ? `&thumb=${thumb}` : '';
	const target =
		`${PUBLIC_POCKETBASE_URL}/api/files/${collection}/` +
		`${encodeURIComponent(event.params.id)}/${encodeURIComponent(event.params.filename)}` +
		`?token=${encodeURIComponent(token)}${thumbParam}`;

	// Forward Range requests so media streaming and seeking work through the
	// proxy: browsers resume paused/raw-seeked video with `Range: bytes=N-` and
	// require the matching 206/Content-Range reply. PocketBase's file endpoint
	// supports ranges natively; authorization is unchanged (same user token).
	const range = event.request.headers.get('range');
	const upstream = await fetch(target, range ? { headers: { range } } : undefined);
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

	const passthrough: Record<string, string> = {};
	for (const name of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
		const value = upstream.headers.get(name);
		if (value) passthrough[name] = value;
	}

	return new Response(upstream.body, {
		// 206 for satisfied range requests, 200 otherwise — as upstream decided.
		status: upstream.status === 206 ? 206 : 200,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
			'content-disposition': disposition,
			'accept-ranges': passthrough['accept-ranges'] ?? 'bytes',
			...passthrough,
			'cache-control': 'private, no-store'
		}
	});
};
