import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { dashboardPath } from '$lib/server/guard';

export const load: PageServerLoad = async ({ locals, url }) => {
	const next = url.searchParams.get('next');
	if (locals.user) redirect(303, next && next.startsWith('/') && !next.startsWith('//') ? next : dashboardPath(locals.user));
	if (next && next.startsWith('/invite/')) redirect(303, next);
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const nextParam = url.searchParams.get('next');
		if (nextParam && nextParam.startsWith('/invite/')) redirect(303, nextParam);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		const passwordConfirm = String(form.get('passwordConfirm') ?? '');

		if (!name || !email || !password) {
			return fail(400, { message: 'Name, email, and password are required.', name, email });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.', name, email });
		}
		if (password !== passwordConfirm) {
			return fail(400, { message: 'Passwords do not match.', name, email });
		}

		try {
			// Every self-service registration creates an Applicant account.
			// The role is set server-side only — management roles can never be
			// requested here; only the Owner can assign them.
			await locals.pb.collection('users').create({
				name,
				email,
				password,
				passwordConfirm,
				role: 'applicant'
			});
			await locals.pb.collection('users').authWithPassword(email, password);
		} catch (err) {
			const message =
				err instanceof Error && err.message.includes('email')
					? 'An account with this email already exists.'
					: 'Registration failed. Please check your details and try again.';
			return fail(400, { message, name, email });
		}

		const redirectNext = url.searchParams.get('next');
		redirect(303, redirectNext && redirectNext.startsWith('/') && !redirectNext.startsWith('//') ? redirectNext : '/dashboard/applicant');
	}
};
