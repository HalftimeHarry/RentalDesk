import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { dashboardPath, requireUser } from '$lib/server/guard';

/** /dashboard simply routes each role to its own dashboard. */
export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	redirect(303, dashboardPath(user));
};
