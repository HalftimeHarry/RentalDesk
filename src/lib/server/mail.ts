/**
 * Outbound email via Resend — test-safe by construction.
 *
 * Server-side gates, ALL evaluated on every send:
 *  1. PRIVATE_EMAIL_ENABLED must be exactly "true". Anything else (unset
 *     included) means DISABLED — the default during tests. sendMail() then
 *     returns { sent: false } without any network call.
 *  2. Recipient allowlist: every To/CC/BCC address must be in EMAIL_ALLOWLIST
 *     below (only the owner's test address). Any other recipient — including
 *     tenant addresses — throws MailBlockedError before any network call.
 *  3. RESEND_API_KEY must be present (read from the environment at send
 *     time; never logged, never sent anywhere except api.resend.com). Server-side
 *     only: no PUBLIC_ prefix, and this module lives in $lib/server.
 *
 * Nothing in the app calls sendMail yet. Do not remove these gates when wiring
 * real notifications.
 */

/** The only addresses email may ever go to while testing. */
export const EMAIL_ALLOWLIST: readonly string[] = Object.freeze(['ddinsmore8@gmail.com']);

export class MailBlockedError extends Error {
	constructor() {
		// Deliberately echoes NO recipient addresses (would leak tenant emails into logs).
		super('Recipient is not in the test allowlist.');
		this.name = 'MailBlockedError';
	}
}

type Env = Record<string, string | undefined>;

/** process.env read lazily via globalThis so no @types/node dependency is needed. */
const runtimeEnv = (): Env =>
	(globalThis as { process?: { env?: Env } }).process?.env ?? {};

/** Email is enabled only by explicit opt-in. Default (tests): disabled. */
export function isEmailEnabled(env: Env = runtimeEnv()): boolean {
	return env.PRIVATE_EMAIL_ENABLED === 'true';
}

const asList = (v: string | string[] | undefined): string[] =>
	v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * Flatten To/CC/BCC and require EVERY address to be allowlisted.
 * Returns the deduplicated recipient list; throws MailBlockedError otherwise.
 */
export function assertAllowedRecipients(input: {
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
}): string[] {
	const all = [...asList(input.to), ...asList(input.cc), ...asList(input.bcc)]
		.map((a) => a.trim().toLowerCase())
		.filter((a) => a.length > 0);
	if (all.length === 0) throw new MailBlockedError();
	for (const addr of all) {
		if (!EMAIL_ALLOWLIST.includes(addr)) throw new MailBlockedError();
	}
	return [...new Set(all)];
}

export interface SendMailInput {
	to: string | string[];
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
}

export interface SendMailResult {
	sent: boolean;
	/** Resend message id when accepted by the provider. */
	id?: string;
	/** Present when nothing was sent. */
	reason?: 'email-disabled';
}

export async function sendMail(
	input: SendMailInput,
	env: Env = runtimeEnv()
): Promise<SendMailResult> {
	if (!isEmailEnabled(env)) return { sent: false, reason: 'email-disabled' };
	const recipients = assertAllowedRecipients(input);
	const apiKey = env.RESEND_API_KEY;
	if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
	const from = env.EMAIL_FROM?.trim() || 'RentalDesk <onboarding@resend.dev>';

	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		signal: AbortSignal.timeout(20_000), // a hung send reports as failed; callers must not auto-retry
		headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({
			from,
			to: asList(input.to).map((a) => a.trim().toLowerCase()),
			...(input.cc ? { cc: asList(input.cc).map((a) => a.trim().toLowerCase()) } : {}),
			...(input.bcc ? { bcc: asList(input.bcc).map((a) => a.trim().toLowerCase()) } : {}),
			subject: input.subject,
			...(input.html ? { html: input.html } : {}),
			...(input.text ? { text: input.text } : {})
		})
	});
	if (!res.ok) {
		// Status only — never log response bodies (could echo recipient data).
		throw new Error(`Resend request failed with status ${res.status}.`);
	}
	const body = (await res.json().catch(() => ({}))) as { id?: string };
	return { sent: true, id: body.id };
}

/** Exposed for tests/audits: who is currently allowed to receive email. */
export function allowedRecipients(): readonly string[] {
	return EMAIL_ALLOWLIST;
}
