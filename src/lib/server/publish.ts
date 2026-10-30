import type PocketBase from 'pocketbase';

/**
 * Server-side bill publisher. Releases draft charges whose scheduled
 * publish_at has arrived. Idempotent and retry-safe: only drafts transition,
 * each update clears publish_at, so a retried run publishes nothing twice and
 * a crash mid-loop simply completes on the next run.
 */
export interface PublishResult {
	published: number;
	bills: { lease: string; month: string; count: number }[];
}

export async function publishDueBills(pb: PocketBase, now = new Date()): Promise<PublishResult> {
	const nowStr = now.toISOString().replace('T', ' ');
	const due = (await pb
		.collection('charges')
		.getFullList({
			filter: `status = "draft" && publish_at != "" && publish_at <= "${nowStr}"`,
			sort: 'lease,period,created'
		})) as { id: string; lease: string; period?: string }[];
	const byBill = new Map<string, number>();
	let published = 0;
	for (const c of due) {
		await pb.collection('charges').update(c.id, { status: 'published', publish_at: '' });
		published++;
		const key = `${c.lease} · ${c.period || ''}`;
		byBill.set(key, (byBill.get(key) ?? 0) + 1);
	}
	return {
		published,
		bills: [...byBill.entries()].map(([k, count]) => {
			const [lease, month] = k.split(' · ');
			return { lease, month, count };
		})
	};
}
