import { defineEnvVars } from '@sveltejs/kit/env';

/**
 * Explicit environment variables (SvelteKit 3 model).
 * Values are read at runtime; PUBLIC_* vars are also sent to the browser.
 */
export const variables = defineEnvVars({
	PUBLIC_POCKETBASE_URL: {
		public: true,
		description: 'Base URL of the PocketBase instance.',
		// Optional — falls back to a local PocketBase during development.
		schema: (value) => value ?? 'http://127.0.0.1:8090'
	},
	PUBLIC_APP_URL: {
		public: true,
		description:
			'Public base URL of the app, used for user-facing links (e.g. admin invitations). Production: https://bstreet102.netlify.app — set to the forwarded dev URL for local testing.',
		schema: (value) => value ?? ''
	}
});
