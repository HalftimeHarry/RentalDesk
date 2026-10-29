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
	}
});
