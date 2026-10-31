import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { Role, User } from '$lib/types';

export const STAFF_ROLES: Role[] = ['owner', 'admin'];

export function isStaff(user: User | null): boolean {
	return !!user && (STAFF_ROLES as string[]).includes(user.role);
}

/** Require a logged-in user; redirects to /login otherwise. */
export function requireUser(event: RequestEvent): User {
	if (!event.locals.user) {
		// Keep the query string so deep links (e.g. ?watch=<tutorial>) survive login.
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	return event.locals.user;
}

/** Require one of the given roles; redirects to the user's own dashboard otherwise. */
export function requireRole(event: RequestEvent, roles: Role[]): User {
	const user = requireUser(event);
	if (!roles.includes(user.role)) {
		redirect(303, '/dashboard');
	}
	return user;
}

/** Home route for a given role. */
export function dashboardPath(user: User): string {
	switch (user.role) {
		case 'owner':
		case 'admin':
			return '/dashboard/manage';
		case 'tenant':
			return '/dashboard/tenant';
		default:
			return '/dashboard/applicant';
	}
}
