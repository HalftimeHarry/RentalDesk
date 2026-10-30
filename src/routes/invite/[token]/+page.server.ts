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
	const su = await createSuperuserClient();
	const invite = await su
		.collection('invitations')
		.getFirstListItem(`token = "${token.replace(/[^a-zA-Z0-9-]/g, '')}"`)
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
			console.error('invite acceptance: role update failed, invitation restored', e);
			return fail(500, {
				message: 'Acceptance failed while updating your account — please try again or ask management for a new invitation.'
			});
		}
		redirect(303, '/dashboard');
	}
};
