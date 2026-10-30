/**
 * Trusted app base URL for user-facing links (invitation emails, etc.).
 *
 * Never constructed from the unvalidated request host. The base comes from the
 * PUBLIC_APP_URL environment setting, validated to a bare http(s) origin.
 *
 * Fail-closed policy:
 *  - Local development/tests: PUBLIC_APP_URL is REQUIRED and must be valid —
 *    otherwise AppUrlConfigError and no link is produced (never silently
 *    pointing at production).
 *  - An invalid configured value throws everywhere, including production.
 *  - The production fallback is used only when the environment is explicitly
 *    identified as production (APP_ENV=production, or Netlify's production
 *    context markers).
 */

export const PRODUCTION_APP_URL = 'https://bstreet102.netlify.app';

export class AppUrlConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AppUrlConfigError';
	}
}

type Env = Record<string, string | undefined>;

/** process.env via globalThis (no @types/node dependency). */
export function serverEnv(): Env {
	return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}

/** True only when the environment is explicitly identified as production. */
export function isExplicitProduction(env: Env = serverEnv()): boolean {
	return env.APP_ENV === 'production' || (env.NETLIFY === 'true' && env.CONTEXT === 'production');
}

/** Bare http(s) origin, or null when invalid. http allowed only on localhost. */
function validate(value: string): string | null {
	try {
		const url = new URL(value);
		const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
		const okProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLocal);
		const bareOrigin = url.pathname === '/' || url.pathname === '';
		if (okProtocol && bareOrigin) return url.origin;
		return null;
	} catch {
		return null;
	}
}

export function appBaseUrl(configured: string | undefined, opts: { production: boolean }): string {
	const value = configured?.trim();
	if (value) {
		const valid = validate(value);
		if (valid) return valid;
		throw new AppUrlConfigError(
			`PUBLIC_APP_URL is set but invalid (${value}) — expected a bare http(s) origin like ${PRODUCTION_APP_URL} or a forwarded dev URL.`
		);
	}
	if (opts.production) return PRODUCTION_APP_URL;
	throw new AppUrlConfigError(
		'PUBLIC_APP_URL is not configured. Set it to this environment’s public URL (for local testing: the forwarded dev URL). No link was created.'
	);
}
