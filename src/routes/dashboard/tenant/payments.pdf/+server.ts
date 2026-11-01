import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireRole } from '$lib/server/guard';
import { buildPaymentHistoryPdf } from '$lib/server/pdf';
import { formatDate, formatMoney } from '$lib/format';
import type { Lease, Payment, PropertyAccess, UnitSettings } from '$lib/types';

const methodLabels: Record<string, string> = {
	cash: 'Cash',
	check: 'Check',
	zelle: 'Zelle',
	venmo: 'Venmo',
	bank_transfer: 'Bank transfer',
	other: 'Other'
};

/**
 * Branded PDF export of the signed-in tenant's complete payment history.
 * Authorization is enforced server-side twice: the role guard limits the route
 * to tenants, and the lease/payments queries run on the USER-scoped PocketBase
 * client, whose collection rules (`lease.tenant = @request.auth.id`) can only
 * ever return the requester's own records.
 */
export const GET: RequestHandler = async (event) => {
	const user = requireRole(event, ['tenant']);
	const { pb } = event.locals;

	let lease: Lease | null = null;
	try {
		lease = (await pb
			.collection('leases')
			.getFirstListItem(`tenant = "${user.id}"`, { sort: '-created' })) as unknown as Lease;
	} catch {
		lease = null;
	}
	if (!lease) error(404, 'No lease is linked to your account.');

	// Same filter and sort as the dashboard table — the PDF mirrors it exactly.
	const payments = (await pb
		.collection('payments')
		.getFullList({ filter: `lease = "${lease.id}"`, sort: '-date' })
		.catch(() => [])) as unknown as Payment[];
	if (payments.length === 0) error(404, 'No payments recorded yet.');

	let settings: UnitSettings | null = null;
	try {
		const list = await pb.collection('settings').getList(1, 1, { sort: 'created' });
		settings = list.items.length > 0 ? (list.items[0] as unknown as UnitSettings) : null;
	} catch {
		settings = null;
	}

	// Unit number: same source and precedence as the dashboard's delivery copy —
	// a gate record's `unit` field holds the display unit number (gates scope by
	// `property`); a lockbox's `unit` is its scope value, so it only qualifies
	// as a fallback when it isn't the settings unit name/address.
	const access = (await pb
		.collection('property_access')
		.getFullList({ sort: 'label' })
		.catch(() => [])) as unknown as PropertyAccess[];
	const unitNumber =
		access.find((e) => e.type === 'gate' && e.unit)?.unit ||
		access.find((e) => e.unit && e.unit !== settings?.unit_name && e.unit !== settings?.address)
			?.unit ||
		'';

	const pdf = buildPaymentHistoryPdf({
		address: settings?.address,
		unitNumber,
		tenantName: user.name || user.email,
		generated: formatDate(new Date().toISOString()),
		rows: payments.map((p) => ({
			date: formatDate(p.date),
			method: methodLabels[p.method] ?? p.method,
			appliesTo: p.applies_to === 'deposit' ? 'Deposit' : 'Rent',
			note: p.note || '',
			amount: formatMoney(p.amount_cents)
		})),
		total: formatMoney(payments.reduce((s, p) => s + p.amount_cents, 0))
	});

	return new Response(new Uint8Array(pdf), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': 'attachment; filename="payment-history.pdf"',
			'Cache-Control': 'no-store'
		}
	});
};
