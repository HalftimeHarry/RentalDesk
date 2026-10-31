import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSuperuserClient } from '$lib/server/pb';
import type { Invitation } from '$lib/types';

/**
 * Public admin-invitation acceptance. The invitation is looked up server-side
 * with the superuser client (the invitations collection is staff-only), so the
 * token in the URL is the bearer secret. Role elevation happens server-side
 * only: this endpoint grants Admin, never anything else.
 */
async function loadInvite(token: string): Promise<Invitation | null> {
	const normalized = token.replace(/[^a-zA-Z0-9-]/g, '');
	const su = await createSuperuserClient();
	const invite = await su
		.collection('invitations')
		.getFirstListItem(`token = "${normalized}"`)
		.catch(() => null);
	if (!invite) return null;
	// Lazily mark expired pending invites.
	if (invite.status === 'pending' && new Date(invite.expires) < new Date()) {
		await su.collection('invitations').update(invite.id, { status: 'expired' }).catch(() => {});
		invite.status = 'expired';
	}
	return invite as unknown as Invitation;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const invite = await loadInvite(params.token);
	if (!invite) error(404, 'Invitation not found.');
	return {
		token: params.token,
		email: invite.email,
		status: invite.status,
		userEmail: locals.user?.email ?? null
	};
};

export const actions: Actions = {
	setup: async ({ params, request, locals }) => {
		const invite = await loadInvite(params.token);
		if (!invite) return fail(404, { message: 'Invitation not found.' });
		if (invite.status !== 'pending') {
			return fail(400, { message: `This invitation is ${invite.status}.` });
		}
		if (locals.user) {
			if (locals.user.email.toLowerCase() === invite.email.toLowerCase()) {
				redirect(303, `/invite/${params.token}`);
			}
			return fail(403, {
				message: `This invitation is for ${invite.email} — sign out before setting up that account.`
			});
		}

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		const passwordConfirm = String(form.get('passwordConfirm') ?? '');

		if (!name || !email || !password) {
			return fail(400, { message: 'Name, email, and password are required.' });
		}
		if (email !== invite.email.toLowerCase()) {
			return fail(403, {
				message: `This invitation is for ${invite.email} — use that email to set up your account.`
			});
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}
		if (password !== passwordConfirm) {
			return fail(400, { message: 'Passwords do not match.' });
		}

		const su = await createSuperuserClient();
		const existing = await su
			.collection('users')
			.getFirstListItem(`email = "${email}"`)
			.catch(() => null);
		if (existing) {
			return fail(409, {
				message: 'An account with this email already exists. Sign in to accept this invitation.'
			});
		}

		try {
			await locals.pb.collection('users').create({
				name,
				email,
				password,
				passwordConfirm,
				role: 'applicant'
			});
			await locals.pb.collection('users').authWithPassword(email, password);
		} catch (e) {
			const err = e as { status?: number; message?: string; response?: { message?: string } } | null;
			const detail = err?.response?.message || err?.message || '';
			if (/email/i.test(detail) || err?.status === 400 || err?.status === 409) {
				return fail(409, {
					message: 'An account with this email already exists. Sign in to accept this invitation.'
				});
			}
			return fail(500, { message: 'Could not create your account. Please try again.' });
		}

		redirect(303, `/invite/${params.token}`);
	},

	accept: async ({ params, locals }) => {
		if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(`/invite/${params.token}`)}`);
		const invite = await loadInvite(params.token);
		if (!invite) return fail(404, { message: 'Invitation not found.' });
		if (invite.status !== 'pending') {
			return fail(400, { message: `This invitation is ${invite.status}.` });
		}
		if (locals.user.email.toLowerCase() !== invite.email.toLowerCase()) {
			return fail(403, {
				message: `This invitation is for ${invite.email} — sign in with that account to accept.`
			});
		}
		// Server-side elevation: invitations grant Admin only, never Owner.
		// The invitation is consumed FIRST so a failure can never leave a granted
		// role behind a still-reusable pending invite. If promotion then fails,
		// the invitation is restored to pending and the error is surfaced.
		const su = await createSuperuserClient();
		await su.collection('invitations').update(invite.id, {
			status: 'accepted',
			accepted_by: locals.user.id,
			accepted_at: new Date().toISOString()
		});
		try {
			if (locals.user.role !== 'admin') {
				await su.collection('users').update(locals.user.id, { role: 'admin' });
			}
		} catch (e) {
			await su
				.collection('invitations')
				.update(invite.id, { status: 'pending', accepted_by: '', accepted_at: '' })
				.catch(() => {});
			return fail(500, {
				message: 'Acceptance failed while updating your account — please try again or ask management for a new invitation.'
			});
		}
		redirect(303, '/dashboard');
	}
};
