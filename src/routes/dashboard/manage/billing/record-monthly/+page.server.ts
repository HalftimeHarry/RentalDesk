import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/guard';
import { getLeaseCharges } from '$lib/server/billing';
import type { Charge, HelpVideo, Lease, Payment } from '$lib/types';

/**
 * Dedicated full page for recording a MONTHLY payment, linked from the billing
 * workspace. Read-only load: the form posts to the existing
 * /dashboard/manage/billing?/recordPayment action, so validation, allocation
 * rules, and the duplicate-payment guard stay in one place.
 */
export const load: PageServerLoad = async (event) => {
	requireRole(event, ['owner', 'admin']);
	const { pb } = event.locals;

	const leaseId = event.url.searchParams.get('lease') ?? '';
	const month = event.url.searchParams.get('month') ?? '';
	if (!leaseId) error(400, 'A lease is required.');
	if (!/^\d{4}-\d{2}$/.test(month)) error(400, 'A billing month (YYYY-MM) is required.');

	let lease: Lease;
	try {
		lease = (await pb
			.collection('leases')
			.getOne(leaseId, { expand: 'tenant' })) as unknown as Lease;
	} catch {
		error(404, 'Lease not found.');
	}

	const chargesRes = await getLeaseCharges(pb, lease.id);
	if (chargesRes.error) error(502, `Charges could not be loaded: ${chargesRes.error}`);
	const payments = (await pb
		.collection('payments')
		.getFullList({ filter: `lease = "${lease.id}"`, sort: '-date' })
		.catch(() => [])) as unknown as Payment[];

	// Walkthrough video for this page, looked up by slug through the USER-scoped
	// client — PocketBase rules decide whether the signed-in manager may see it,
	// and the player resolves file URLs itself (nothing hardcoded here).
	let helpVideo: HelpVideo | null = null;
	try {
		helpVideo = (await pb
			.collection('help_videos')
			.getFirstListItem('slug = "record-monthly-payment" && active = true')) as unknown as HelpVideo;
	} catch {
		helpVideo = null;
	}

	return {
		lease,
		month,
		charges: chargesRes.charges as Charge[],
		payments,
		helpVideo,
		today: new Date().toISOString().slice(0, 10)
	};
};
