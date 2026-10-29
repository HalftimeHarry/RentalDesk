import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { dashboardPath } from '$lib/server/guard';
import type { User } from '$lib/types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, dashboardPath(locals.user));
	return { next: url.searchParams.get('next') ?? '' };
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { message: 'Email and password are required.', email });
		}

		try {
			await locals.pb.collection('users').authWithPassword(email, password);
		} catch {
			return fail(400, { message: 'Invalid email or password.', email });
		}

		// locals.user was populated by hooks BEFORE this action ran — use the
		// freshly authenticated record for the role-based redirect.
		const user = locals.pb.authStore.record as unknown as User | null;
		locals.user = user;
		const next = url.searchParams.get('next');
		const target =
			next && next.startsWith('/') && !next.startsWith('//')
				? next
				: user
					? dashboardPath(user)
					: '/';
		redirect(303, target);
	}
};
