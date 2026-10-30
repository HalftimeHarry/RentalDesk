/**
 * Safety guard for database verification scripts.
 *
 * Decides whether a PocketBase URL is an acceptable target for scripts that
 * create and delete test fixtures:
 *  - localhost / loopback is always permitted (local dev instance).
 *  - A remote host is permitted ONLY when it is explicitly confirmed as a
 *    dedicated test instance via the POCKETBASE_TEST_INSTANCE_CONFIRMED
 *    environment variable, which must equal the exact hostname.
 *  - The production Railway host is ALWAYS rejected, even if confirmed.
 *
 * Call this BEFORE authenticating or writing anything. Never prints
 * credentials — only the URL host appears in messages.
 */

/** Production hosts that verification scripts must never touch. */
const PRODUCTION_HOSTS = new Set(['pocketbase-railway-production-f446.up.railway.app']);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function refuse(message) {
	console.error(`REFUSED — unsafe PocketBase target: ${message}`);
	console.error('Verification scripts run against a local instance by default.');
	console.error(
		'For a dedicated remote TEST instance, set POCKETBASE_TEST_INSTANCE_CONFIRMED to its exact hostname.'
	);
	process.exit(1);
}

/**
 * Exit the process unless `rawUrl` points at a safe (non-production) target.
 * @param {string | undefined} rawUrl value of PUBLIC_POCKETBASE_URL
 */
export function assertSafePocketBaseTarget(rawUrl) {
	if (!rawUrl) refuse('PUBLIC_POCKETBASE_URL is not set.');

	let url;
	try {
		url = new URL(rawUrl);
	} catch {
		refuse('PUBLIC_POCKETBASE_URL is not a valid URL.');
	}

	const host = url.hostname.toLowerCase();

	// Hard stop first: production can never be confirmed away.
	if (PRODUCTION_HOSTS.has(host)) {
		refuse(`${host} is the PRODUCTION PocketBase. Tests would modify live tenant data.`);
	}

	if (LOCAL_HOSTS.has(host)) return; // local dev instance — always fine

	if (process.env.POCKETBASE_TEST_INSTANCE_CONFIRMED === host) return; // explicit test instance

	refuse(
		`${host} is a remote host. Set POCKETBASE_TEST_INSTANCE_CONFIRMED=${host} only if it is a dedicated test instance with no real tenant data.`
	);
}
