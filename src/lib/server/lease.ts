import type PocketBase from 'pocketbase';
import type { Lease } from '$lib/types';

export interface ActiveLeaseResult {
	lease: Lease | null;
	/** Set only when the query itself failed — never conflate with "no active lease". */
	error: string | null;
}

/**
 * The intended active lease — the single shared lookup used by every
 * management page (dashboard, billing). Latest active lease wins.
 */
export async function getActiveLease(pb: PocketBase): Promise<ActiveLeaseResult> {
	try {
		const lease = (await pb
			.collection('leases')
			.getFirstListItem('status = "active"', { expand: 'tenant', sort: '-created' })) as unknown as Lease;
		return { lease, error: null };
	} catch (e) {
		const err = e as { status?: number; message?: string };
		// getFirstListItem throws 404 when nothing matches — that means "no active lease".
		if (err?.status === 404) return { lease: null, error: null };
		return { lease: null, error: err?.message || 'PocketBase query failed' };
	}
}

/**
 * The lease a billing view should default to: the active lease when one
 * exists, otherwise the most recently created lease of any status — ended
 * leases still carry charges, payments, and documents that must stay visible.
 */
export async function getDefaultLease(pb: PocketBase): Promise<ActiveLeaseResult> {
	const active = await getActiveLease(pb);
	if (active.lease || active.error) return active;
	try {
		const lease = (await pb
			.collection('leases')
			.getFirstListItem('id != ""', { expand: 'tenant', sort: '-created' })) as unknown as Lease;
		return { lease, error: null };
	} catch (e) {
		const err = e as { status?: number; message?: string };
		if (err?.status === 404) return { lease: null, error: null };
		return { lease: null, error: err?.message || 'PocketBase query failed' };
	}
}

/**
 * The pending lease — created from an approved application but not yet
 * activated (awaiting the signed packet + explicit activation). Pending leases
 * never appear in tenant or billing views until activated.
 */
export async function getPendingLease(pb: PocketBase): Promise<ActiveLeaseResult> {
	try {
		const lease = (await pb
			.collection('leases')
			.getFirstListItem('status = "pending"', { expand: 'tenant', sort: '-created' })) as unknown as Lease;
		return { lease, error: null };
	} catch (e) {
		const err = e as { status?: number; message?: string };
		if (err?.status === 404) return { lease: null, error: null };
		return { lease: null, error: err?.message || 'PocketBase query failed' };
	}
}
