import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireUser } from '$lib/server/guard';
import { getDefaultLease } from '$lib/server/lease';
import { getLeaseCharges } from '$lib/server/billing';
import { depositCharges, groupChargesByMonth } from '$lib/billing';
import type { Lease, Payment, UnitSettings } from '$lib/types';

/**
 * Printable monthly statement. Tenants always get their own latest lease
 * (PocketBase rules further restrict them to published charges); management
 * may pass ?lease=<id>. The statement itself only ever shows published
 * charges — drafts never appear on a tenant-facing document.
 */
export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const { pb } = event.locals;

	const month = event.url.searchParams.get('month') ?? '';
	if (!/^\d{4}-\d{2}$/.test(month)) error(400, 'A billing month (?month=YYYY-MM) is required.');

	let lease: Lease | null = null;
	if (user.role === 'tenant') {
		lease = (await pb
			.collection('leases')
			.getFirstListItem(`tenant = "${user.id}"`, { sort: '-created', expand: 'tenant' })
			.catch(() => null)) as unknown as Lease | null;
	} else if (user.role === 'owner' || user.role === 'admin') {
		const requested = event.url.searchParams.get('lease') ?? '';
		lease = requested
			? ((await pb
					.collection('leases')
					.getOne(requested, { expand: 'tenant' })
					.catch(() => null)) as unknown as Lease | null)
			: (await getDefaultLease(pb)).lease;
	} else {
		error(403, 'Not available for your account.');
	}
	if (!lease) error(404, 'No lease found.');

	const { charges, error: chargesError } = await getLeaseCharges(pb, lease.id);
	if (chargesError) error(502, `Could not load charges: ${chargesError}`);
	const payments = (await pb
		.collection('payments')
		.getFullList({ filter: `lease = "${lease.id}"`, sort: 'date,created' })
		.catch(() => [])) as unknown as Payment[];

	const published = charges.filter((c) => c.status === 'published');
	const statement =
		groupChargesByMonth(published, payments).find((s) => s.month === month) ?? null;

	// Branding for the printed statement: unit/business info plus the owner
	// account's display name (best-effort — tenants may not be able to list users).
	const settings = (await pb
		.collection('settings')
		.getList(1, 1, { sort: 'created' })
		.then((l) => l.items[0] ?? null)
		.catch(() => null)) as unknown as UnitSettings | null;
	const owner = (await pb
		.collection('users')
		.getFirstListItem('role = "owner"')
		.catch(() => null)) as { name?: string; email?: string } | null;

	return {
		user,
		lease,
		month,
		statement,
		deposits: depositCharges(published),
		payments,
		unitName: settings?.unit_name ?? '',
		businessAddress: settings?.address ?? '',
		ownerName: owner?.name || owner?.email || ''
	};
};
