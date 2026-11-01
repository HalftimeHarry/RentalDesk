/**
 * Development-only PocketBase target guard.
 *
 * While the dev server is running (`vite dev`), the ONLY permitted PocketBase
 * target is the isolated local instance — http://127.0.0.1:8090. Anything else
 * (the production host, a forwarded URL, even http://localhost:8090) is
 * rejected with a clear error BEFORE a client is created or a request is sent,
 * so a stray `.env` can never point a dev server at production.
 *
 * There is intentionally NO override: development must use the local instance.
 * Outside development (production builds, Netlify runtime, `vite preview`)
 * the guard is a no-op.
 *
 * Pure module — no SvelteKit imports — so it runs identically in the server
 * and browser bundles and in `node --test`. Callers pass `dev` from
 * `$app/env`. Error messages only ever include the URL's host,
 * never credentials or other configuration values.
 */

/** The only PocketBase target permitted during development. */
export const DEV_POCKETBASE_URL = 'http://127.0.0.1:8090';

export class PocketBaseDevTargetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PocketBaseDevTargetError';
	}
}

/** Host shown in errors — never the full URL, path, or any credentials. */
function describeHost(rawUrl: string): string {
	try {
		return new URL(rawUrl).host || '<empty>';
	} catch {
		return '<unparseable>';
	}
}

/**
 * Throw unless `rawUrl` is exactly the local dev PocketBase instance.
 * No-op when `isDev` is false.
 */
export function assertDevPocketBaseTarget(rawUrl: string | undefined, isDev: boolean): void {
	if (!isDev) return;
	const normalized = (rawUrl ?? '').trim().replace(/\/+$/, '');
	if (normalized === DEV_POCKETBASE_URL) return;
	throw new PocketBaseDevTargetError(
		`Development refuses PocketBase target "${describeHost(normalized)}" — ` +
			`only ${DEV_POCKETBASE_URL} is permitted while the dev server is running. ` +
			`Start the app with the .env.test files per AGENTS.md (port 5174) so it ` +
			`uses the isolated local instance. There is no override.`
	);
}
