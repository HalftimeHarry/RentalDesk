/**
 * Reusable Rental Desk email templates (HTML + plain text).
 *
 * Design mirrors the app palette: white content card on sand, light-green
 * header with a text wordmark (no reliable public logo URL exists yet),
 * ocean-blue action button, dark navy text, subtle coastal accents.
 *
 * Safety: ALL dynamic content is HTML-escaped. These templates feed the
 * guarded sendMail() in ./mail.ts — recipient allowlist and the enable flag
 * still apply. Nothing here sends anything.
 */

import { formatDate, formatMoney } from '../format.ts';

/** Production dashboard base for email links. */
export const EMAIL_APP_URL = 'https://bstreet102.netlify.app';

/** Stable authenticated tutorial deep links (?watch=<slug> opens the dialog
 *  after login). Plain app URLs only — no file tokens, no invite tokens. */
export function tutorialLinks(appUrl: string = EMAIL_APP_URL) {
	const base = appUrl.replace(/\/+$/, '');
	return {
		billingOverview: {
			title: 'Billing overview',
			description: 'A quick tour of the admin billing dashboard and account status.',
			url: `${base}/dashboard/manage?watch=billing-overview`
		},
		tenantDashboardAdmin: {
			title: 'Tenant dashboard overview',
			description: 'See the dashboard your tenants use — balances, payments, and requests.',
			url: `${base}/dashboard/manage?watch=tenant-dashboard-overview`
		},
		tenantDashboard: {
			title: 'Tenant dashboard overview',
			description: 'A quick walkthrough of your dashboard, key balances, and navigation.',
			url: `${base}/dashboard/tenant?watch=tenant-dashboard-overview`
		}
	};
}

export function escapeHtml(value: unknown): string {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface EmailItem {
	label: string;
	value: string;
}

/** Tutorial link block: clickable play-badge card + descriptive text link.
 *  URLs are stable authenticated app pages — NEVER file tokens or invite tokens. */
export interface EmailTutorial {
	title: string;
	description: string;
	url: string;
}

export interface EmailTemplateInput {
	/** Short inbox preheader (hidden in the body). */
	preheader: string;
	greeting: string;
	heading: string;
	/** Body paragraphs (plain text — escaped on render). */
	paragraphs: string[];
	/** Optional itemized amounts/details. */
	items?: EmailItem[];
	/** One primary action button. */
	action?: { label: string; url: string };
	/** Optional tutorial links (sign-in required to watch). */
	tutorials?: EmailTutorial[];
}

export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

const FOOTER_LINE = 'Dustin Dinsmore · Rental Desk';
const FOOTER_NOTE = 'Sensitive documents are available through the secure dashboard.';

/** Master layout — table-based, inline styles, fluid width for mobile clients. */
export function renderEmail(subject: string, input: EmailTemplateInput): RenderedEmail {
	const esc = escapeHtml;
	const itemsHtml = (input.items ?? [])
		.map(
			(i) => `<tr>
  <td style="padding:8px 0;color:#5b7288;font-size:14px;border-bottom:1px solid #eef2f5;">${esc(i.label)}</td>
  <td align="right" style="padding:8px 0;color:#16324f;font-size:14px;font-weight:600;border-bottom:1px solid #eef2f5;">${esc(i.value)}</td>
</tr>`
		)
		.join('');

	const actionHtml = input.action
		? `<tr><td align="center" style="padding:24px 0 8px;">
  <a href="${esc(input.action.url)}" style="display:inline-block;background-color:#075985;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:10px;">${esc(input.action.label)}</a>
</td></tr>`
		: '';

	// Tutorial cards: a clickable play-badge "thumbnail" built from plain markup
	// (the real thumbnails are protected files and stay in the app) plus a
	// descriptive text link. Watching requires signing in — the links are stable
	// authenticated pages, never tokens.
	const tutorialsHtml =
		input.tutorials && input.tutorials.length > 0
			? `<tr><td style="padding:20px 0 0;">
  <p style="margin:0 0 10px;color:#16324f;font-size:15px;font-weight:600;">Video tutorials (sign in to watch)</p>
  ${input.tutorials
		.map(
			(t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #e8e0d2;border-radius:10px;">
  <tr>
    <td width="64" align="center" style="padding:12px 0 12px 12px;">
      <a href="${esc(t.url)}" style="display:inline-block;width:48px;height:48px;background-color:#075985;border-radius:24px;color:#ffffff;font-size:20px;line-height:48px;text-align:center;text-decoration:none;" aria-label="Watch ${esc(t.title)}">&#9658;</a>
    </td>
    <td style="padding:12px;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0;color:#16324f;font-size:14px;font-weight:600;">${esc(t.title)}</p>
      <p style="margin:2px 0 6px;color:#5b7288;font-size:13px;line-height:1.4;">${esc(t.description)}</p>
      <a href="${esc(t.url)}" style="color:#075985;font-size:13px;font-weight:600;text-decoration:underline;">Watch the ${esc(t.title)} tutorial</a>
    </td>
  </tr>
</table>`
		)
		.join('\n  ')}
</td></tr>`
			: '';

	const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#fff9f0;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(input.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff9f0;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e0d2;">
    <tr>
      <td style="background-color:#e2f2ee;padding:20px 28px;border-bottom:3px solid #0f766e;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#16324f;letter-spacing:0.2px;">Rental Desk</span>
        <span style="float:right;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#0f766e;padding-top:6px;">coastal property management</span>
      </td>
    </tr>
    <tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0 0 4px;color:#5b7288;font-size:14px;">${esc(input.greeting)}</p>
      <h1 style="margin:0 0 16px;color:#16324f;font-size:20px;line-height:1.3;">${esc(input.heading)}</h1>
      ${input.paragraphs.map((p) => `<p style="margin:0 0 12px;color:#16324f;font-size:15px;line-height:1.55;">${esc(p)}</p>`).join('\n      ')}
      ${itemsHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">${itemsHtml}</table>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${actionHtml}${tutorialsHtml}</table>
    </td></tr>
    <tr>
      <td style="padding:16px 28px;border-top:1px solid #eef2f5;background-color:#fdfcf9;">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#16324f;font-weight:600;">${FOOTER_LINE}</p>
        <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a97a3;">${FOOTER_NOTE}</p>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

	const lines = [
		input.greeting,
		'',
		input.heading,
		'',
		...input.paragraphs,
		...(input.items ?? []).map((i) => `- ${i.label}: ${i.value}`),
		...(input.action ? ['', `${input.action.label}: ${input.action.url}`] : []),
		...(input.tutorials && input.tutorials.length > 0
			? [
					'',
					'Video tutorials (sign in to watch):',
					...input.tutorials.map((t) => `- ${t.title} — ${t.description} Watch: ${t.url}`)
				]
			: []),
		'',
		'--',
		FOOTER_LINE,
		FOOTER_NOTE
	];
	return { subject, html, text: lines.join('\n') };
}

// ---- concrete templates -------------------------------------------------------

export function statementReadyEmail(input: {
	name: string;
	month: string; // e.g. "November 2026"
	totalDueCents: number;
	url?: string;
}): RenderedEmail {
	const url = input.url ?? `${EMAIL_APP_URL}/dashboard/tenant`;
	return renderEmail(`Your ${input.month} statement is ready`, {
		preheader: `Your ${input.month} statement is ready to view.`,
		greeting: `Hi ${input.name},`,
		heading: `${input.month} statement ready`,
		paragraphs: [
			`Your rental statement for ${input.month} is ready. You can review the charges and any payments recorded in your dashboard.`,
			'Nothing in this email includes sensitive documents — those stay in your secure dashboard.'
		],
		items: [{ label: `Balance due for ${input.month}`, value: formatMoney(input.totalDueCents) }],
		action: { label: 'View statement', url }
	});
}

export function paymentRecordedEmail(input: {
	name: string;
	amountCents: number;
	date: string; // YYYY-MM-DD
	method: string;
	reference: string;
	charge: string; // description of the charge paid
	url?: string;
}): RenderedEmail {
	const url = input.url ?? `${EMAIL_APP_URL}/dashboard/tenant`;
	return renderEmail(`Payment recorded — ${formatMoney(input.amountCents)}`, {
		preheader: `A payment of ${formatMoney(input.amountCents)} was recorded on your account.`,
		greeting: `Hi ${input.name},`,
		heading: 'Payment recorded',
		paragraphs: [
			'We’ve recorded your payment. Please review the details below and contact management if anything looks off.'
		],
		items: [
			{ label: 'Amount', value: formatMoney(input.amountCents) },
			{ label: 'Date', value: formatDate(input.date) },
			{ label: 'Method', value: input.method },
			...(input.reference ? [{ label: 'Reference', value: input.reference }] : []),
			{ label: 'Applied to', value: input.charge }
		],
		action: { label: 'Open dashboard', url }
	});
}

export function newMessageEmail(input: { name: string; url?: string }): RenderedEmail {
	const url = input.url ?? `${EMAIL_APP_URL}/dashboard`;
	return renderEmail('New message from Rental Desk', {
		preheader: 'You have a new message waiting in your dashboard.',
		greeting: `Hi ${input.name},`,
		heading: 'You have a new message',
		paragraphs: [
			'Management sent you a message. For your privacy, the message text is not included in email — sign in to read it and reply.'
		],
		action: { label: 'Read message', url }
	});
}

export function inspectionSignedEmail(input: {
	address: string;
	unit: string;
	type: string; // move_in | move_out | periodic
	date: string; // YYYY-MM-DD
	signedAt: string; // YYYY-MM-DD ('' tolerated)
	url: string; // secure app link to the exact signed report — never a file token
	/** Tenant-facing copies only: include the tenant dashboard tutorial. */
	tutorials?: EmailTutorial[];
}): RenderedEmail {
	const typeLabels: Record<string, string> = {
		move_in: 'Move-in',
		move_out: 'Move-out',
		periodic: 'Periodic'
	};
	const typeLabel = typeLabels[input.type] ?? input.type;
	const where = `${input.address}${input.unit ? `, Unit ${input.unit}` : ''}`;
	return renderEmail(`${typeLabel} inspection signed — ${input.address}`, {
		preheader: `The ${typeLabel.toLowerCase()} inspection for ${where} is fully signed.`,
		greeting: 'Hello,',
		heading: `${typeLabel} inspection fully signed`,
		paragraphs: [
			`The condition report for ${where} has been signed by both the landlord and the tenant.`,
			'Use the button below to view the exact signed report in the secure dashboard.'
		],
		items: [
			{ label: 'Property', value: where },
			{ label: 'Inspection', value: typeLabel },
			{ label: 'Inspection date', value: formatDate(input.date) },
			...(input.signedAt ? [{ label: 'Fully signed', value: formatDate(input.signedAt) }] : [])
		],
		action: { label: 'View signed report', url: input.url },
		...(input.tutorials && input.tutorials.length > 0 ? { tutorials: input.tutorials } : {})
	});
}

export function inviteAdminEmail(input: {
	inviterName: string;
	url: string;
	expires: string; // ISO datetime — shown as the actual expiration date
	/** App origin for tutorial links (defaults to production). */
	appUrl?: string;
}): RenderedEmail {
	const tutorials = tutorialLinks(input.appUrl);
	return renderEmail(`${input.inviterName} invited you to Rental Desk`, {
		preheader: `${input.inviterName} invited you to help manage a rental property.`,
		greeting: 'Hello,',
		heading: 'You’re invited to join as an Admin',
		paragraphs: [
			`${input.inviterName} has invited you to help manage a rental property with Rental Desk.`,
			'Rental Desk brings the property listing, applications, lease documents, billing, maintenance, inspections, and the move-out process into one place — with the goal of clear communication and a personalized experience for both landlords and tenants.',
			'We’re in a six-month pilot (through April 2027), so feedback is very welcome along the way.',
			'As an Admin you can review applicants, manage billing and payments, track maintenance and inspections, handle move-out notices, message applicants and tenants, and invite other admins. Directly changing account roles stays with the Owner.',
			'The short tutorials below show you around — accept the invitation and sign in first, then they open right in your dashboard.',
			`This invitation expires on ${formatDate(input.expires)}. If you weren’t expecting it, you can simply ignore this email.`
		],
		action: { label: 'Accept admin invitation', url: input.url },
		// Both staff tutorials — plain authenticated app links (no tokens).
		tutorials: [tutorials.billingOverview, tutorials.tenantDashboardAdmin]
	});
}

// ---- fictional previews (development only) --------------------------------------

export interface EmailPreview {
	id: string;
	title: string;
	subject: string;
	html: string;
	text: string;
}

/** Fully fictional sample data — never reads the database. */
export function previewEmails(): EmailPreview[] {
	const statement = statementReadyEmail({
		name: 'Alex Rivera',
		month: 'November 2026',
		totalDueCents: 220000
	});
	const payment = paymentRecordedEmail({
		name: 'Alex Rivera',
		amountCents: 100000,
		date: '2026-10-30',
		method: 'Check',
		reference: 'CHK-1001',
		charge: 'Rent — November 2026'
	});
	const message = newMessageEmail({ name: 'Alex Rivera' });
	const invite = inviteAdminEmail({
		inviterName: 'Dana Kim',
		url: `${EMAIL_APP_URL}/invite/00000000-0000-0000-0000-000000000000`,
		expires: '2026-11-06T12:00:00.000Z'
	});
	const inspectionTenant = inspectionSignedEmail({
		address: '102 B Street',
		unit: 'A',
		type: 'move_in',
		date: '2026-10-28',
		signedAt: '2026-10-30',
		url: `${EMAIL_APP_URL}/dashboard/tenant`,
		tutorials: [tutorialLinks().tenantDashboard]
	});
	return [
		{ id: 'statement', title: 'Monthly statement ready', ...statement },
		{ id: 'payment', title: 'Payment recorded', ...payment },
		{ id: 'message', title: 'New message notification', ...message },
		{ id: 'invite', title: 'Admin invitation', ...invite },
		{ id: 'inspection-tenant', title: 'Inspection signed (tenant copy)', ...inspectionTenant }
	];
}
