/**
 * Signed-inspection email confirmation.
 *
 * Recipients are resolved from RECORDS only: the landlord side is the staff
 * account that created the inspection (created_by), the tenant side is the user
 * account linked through the lease — never parsed out of the free-text
 * tenant_names, and never "every Admin". Delivery is tracked per recipient per
 * signed inspection record (a revision is a new record, so tracking is
 * version-scoped). Failures are recorded and retryable; successful deliveries
 * are never resent. A delivery failure must never undo the signed inspection.
 */
import type PocketBase from 'pocketbase';
import type { Inspection, InspectionNotification } from '$lib/types';
import { sendMail } from './mail.ts';
import { inspectionSignedEmail, tutorialLinks } from './email-templates.ts';

export interface ResolvedRecipient {
	role: 'landlord' | 'tenant';
	userId: string;
	name: string;
	email: string;
}

export interface ResolvedRecipients {
	recipients: ResolvedRecipient[];
	/** Human-readable limitations to show management (never sent anywhere). */
	limitations: string[];
}

/** Split the free-text tenant_names into distinct people ("A, B", "A and B"). */
export function namedTenants(tenantNames: string): string[] {
	return (tenantNames ?? '')
		.split(/\s*(?:,|;|&|\band\b)\s*/i)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Narrow an expand value (record object or bare relation id) to a party. */
function toParty(v: unknown): { id: string; email?: string; name?: string } | null {
	if (!v || typeof v !== 'object') return null;
	const r = v as { id?: unknown; email?: unknown; name?: unknown };
	if (typeof r.id !== 'string' || !r.id) return null;
	return {
		id: r.id,
		email: typeof r.email === 'string' && r.email ? r.email : undefined,
		name: typeof r.name === 'string' && r.name ? r.name : undefined
	};
}

type PBLike = Pick<PocketBase, 'collection'>;

/**
 * Narrowly scoped server-only privileged lookup: fetch ONE user record by id
 * via the privileged client and return ONLY its email. The record itself is
 * discarded — emails never enter client loaders, API responses, or logs.
 */
async function privilegedEmailLookup(pb: PBLike, userId: string): Promise<string | null> {
	if (!userId) return null;
	const rec = await pb.collection('users').getOne(userId).catch(() => null);
	return rec && typeof rec.email === 'string' && rec.email ? rec.email : null;
}

export interface RecipientsPreview {
	recipients: { role: 'landlord' | 'tenant'; name: string }[];
	limitations: string[];
}

/**
 * Management-facing intended-recipients preview: names and roles only —
 * NEVER email addresses (those are resolved privilegedly at send time).
 */
export function recipientsPreview(input: {
	landlordName?: string | null;
	tenantName?: string | null;
	tenantNames?: string;
}): RecipientsPreview {
	const recipients: RecipientsPreview['recipients'] = [];
	const limitations: string[] = [];
	if (input.landlordName) {
		recipients.push({ role: 'landlord', name: input.landlordName });
	} else {
		limitations.push('The staff account that created this inspection could not be resolved — no landlord confirmation will be sent.');
	}
	const names = namedTenants(input.tenantNames ?? '');
	if (input.tenantName) {
		recipients.push({ role: 'tenant', name: input.tenantName });
		if (names.length > 1) {
			limitations.push(
				`Only the lease's tenant account receives the email — ${names.length - 1} other named tenant(s) have no account and won't receive a copy.`
			);
		}
	} else {
		limitations.push('No tenant account is linked through the lease — the tenant will not be emailed.');
	}
	return { recipients, limitations };
}

/**
 * Pure resolution. Landlord: the staff account that created the inspection.
 * Tenant: the account linked via the lease. Extra named tenants without
 * accounts are reported as a limitation — nobody assumes they got a copy.
 */
export function resolveRecipients(input: {
	createdBy?: unknown;
	tenantAccount?: unknown;
	tenantNames?: string;
}): ResolvedRecipients {
	const recipients: ResolvedRecipient[] = [];
	const limitations: string[] = [];
	const createdBy = toParty(input.createdBy);
	const tenantAccount = toParty(input.tenantAccount);

	if (createdBy?.email) {
		recipients.push({
			role: 'landlord',
			userId: createdBy.id,
			name: createdBy.name || createdBy.email,
			email: createdBy.email
		});
	} else {
		limitations.push('The landlord/manager account on this inspection has no email — no landlord confirmation was sent.');
	}

	const names = namedTenants(input.tenantNames ?? '');
	if (tenantAccount?.email) {
		recipients.push({
			role: 'tenant',
			userId: tenantAccount.id,
			name: tenantAccount.name || tenantAccount.email,
			email: tenantAccount.email
		});
		if (names.length > 1) {
			limitations.push(
				`Only the lease's tenant account receives the email — ${names.length - 1} other named tenant(s) have no account and were not sent a copy.`
			);
		}
	} else {
		limitations.push('No tenant account is linked through the lease — the tenant was not emailed.');
	}

	return { recipients, limitations };
}

async function attemptDelivery(
	pb: PBLike,
	row: InspectionNotification,
	inspection: Inspection,
	baseUrl: string
): Promise<void> {
	const email = inspectionSignedEmail({
		address: inspection.address,
		unit: inspection.unit,
		type: inspection.type,
		date: String(inspection.date).slice(0, 10),
		signedAt: String(inspection.sig_tenant_at || inspection.sig_landlord_at || '').slice(0, 10),
		url:
			row.role === 'landlord'
				? `${baseUrl}/dashboard/inspections/${inspection.id}`
				: `${baseUrl}/dashboard/tenant`,
		// Tenant-facing copies only: link the tenant dashboard tutorial (a stable
		// authenticated app page — no file or invite tokens in email).
		...(row.role === 'tenant' ? { tutorials: [tutorialLinks(baseUrl).tenantDashboard] } : {})
	});
	const attempts = (row.attempts ?? 0) + 1;
	try {
		const result = await sendMail({ to: row.email, subject: email.subject, html: email.html, text: email.text });
		if (result.sent) {
			await pb.collection('inspection_notifications').update(row.id, {
				status: 'sent',
				sent_at: new Date().toISOString(),
				attempts,
				error: ''
			});
		}
		// sent === false means email is disabled by configuration — the row stays
		// 'pending' (a config state, not a failure), with no attempt counted.
	} catch (e) {
		await pb.collection('inspection_notifications').update(row.id, {
			status: 'failed',
			error: e instanceof Error ? e.message.slice(0, 500) : 'unknown error',
			attempts
		});
	}
}

/**
 * Create (idempotently) and attempt one delivery per resolved recipient.
 * Callers: only after the signed stage is fully persisted, with a PRIVILEGED
 * (superuser) client — recipient emails are resolved here via narrow lookups
 * and never leave this server-side path. Never throws.
 */
export async function notifySignedInspection(
	pb: PBLike,
	inspection: Inspection,
	baseUrl: string
): Promise<{ pending: number; sent: number; failed: number; limitations: string[] }> {
	// Landlord: the staff account that created the inspection. Tenant: the
	// account linked through the lease. Emails come from narrow privileged
	// lookups only (record discarded immediately).
	const landlordId = inspection.created_by;
	const lease = inspection.lease
		? await pb.collection('leases').getOne(inspection.lease).catch(() => null)
		: null;
	const tenantId = lease?.tenant ?? '';
	const [landlordEmail, tenantEmail] = await Promise.all([
		privilegedEmailLookup(pb, landlordId),
		tenantId ? privilegedEmailLookup(pb, tenantId) : Promise.resolve(null)
	]);
	const { recipients, limitations } = resolveRecipients({
		createdBy: landlordId
			? { id: landlordId, name: inspection.expand?.created_by?.name, email: landlordEmail ?? undefined }
			: null,
		tenantAccount: tenantId
			? { id: tenantId, name: inspection.expand?.lease?.expand?.tenant?.name, email: tenantEmail ?? undefined }
			: null,
		tenantNames: inspection.tenant_names
	});
	const counts = { pending: 0, sent: 0, failed: 0 };
	for (const r of recipients) {
		let row = (await pb
			.collection('inspection_notifications')
			.getFirstListItem(`inspection = "${inspection.id}" && email = "${r.email}"`)
			.catch(() => null)) as unknown as InspectionNotification | null;
		if (!row) {
			row = (await pb.collection('inspection_notifications').create({
				inspection: inspection.id,
				recipient: r.userId,
				email: r.email,
				role: r.role,
				status: 'pending',
				attempts: 0
			})) as unknown as InspectionNotification;
		}
		if (row.status === 'sent') {
			counts.sent++;
			continue; // successful deliveries are never resent
		}
		await attemptDelivery(pb, row, inspection, baseUrl).catch(() => {});
		const fresh = (await pb
			.collection('inspection_notifications')
			.getOne(row.id)
			.catch(() => row)) as unknown as InspectionNotification;
		counts[fresh.status === 'sent' ? 'sent' : fresh.status === 'failed' ? 'failed' : 'pending']++;
	}
	return { ...counts, limitations };
}

/** Retry only pending/failed deliveries for an inspection; sent rows untouched. */
export async function retryFailedNotifications(
	pb: PBLike,
	inspection: Inspection,
	baseUrl: string
): Promise<{ retried: number; sent: number; failed: number }> {
	const rows = (await pb
		.collection('inspection_notifications')
		.getFullList({ filter: `inspection = "${inspection.id}" && status != "sent"` })
		.catch(() => [])) as unknown as InspectionNotification[];
	let sent = 0;
	let failed = 0;
	for (const row of rows) {
		await attemptDelivery(pb, row, inspection, baseUrl).catch(() => {});
		const fresh = (await pb
			.collection('inspection_notifications')
			.getOne(row.id)
			.catch(() => row)) as unknown as InspectionNotification;
		if (fresh.status === 'sent') sent++;
		else if (fresh.status === 'failed') failed++;
	}
	return { retried: rows.length, sent, failed };
}
