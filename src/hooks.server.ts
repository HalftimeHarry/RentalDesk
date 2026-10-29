import type { Handle } from '@sveltejs/kit/hooks';
import { createPocketBase } from '$lib/server/pb';
import type { User } from '$lib/types';

export const handle: Handle = async ({ event, resolve }) => {
	const pb = createPocketBase();
	pb.authStore.loadFromCookie(event.request.headers.get('cookie') ?? '');

	try {
		if (pb.authStore.isValid) {
			await pb.collection('users').authRefresh();
		}
	} catch {
		// Token expired or PocketBase unreachable — treat as logged out.
		pb.authStore.clear();
	}

	event.locals.pb = pb;
	event.locals.user = pb.authStore.record
		? (structuredClone(pb.authStore.record) as unknown as User)
		: null;

	const response = await resolve(event);

	// Persist (or clear) the auth cookie on every response.
	response.headers.append(
		'set-cookie',
		pb.authStore.exportToCookie({
			httpOnly: true,
			secure: event.url.protocol === 'https:',
			sameSite: 'lax',
			path: '/'
		})
	);

	return response;
};
