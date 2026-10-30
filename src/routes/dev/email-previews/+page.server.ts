import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import type { PageServerLoad } from './$types';
import { previewEmails } from '$lib/server/email-templates';

/**
 * Development-only email template preview. Returns 404 in production builds,
 * and renders only the fictional sample data from previewEmails() — it never
 * touches PocketBase, so no real tenant data can appear here.
 */
export const load: PageServerLoad = () => {
	if (!dev) error(404, 'Not found');
	return { previews: previewEmails() };
};
