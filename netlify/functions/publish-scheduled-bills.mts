/**
 * Netlify Scheduled Function — publishes draft bill charges whose scheduled
 * publish_at has arrived. Runs on Netlify infrastructure every 15 minutes
 * (UTC cron), so bills publish even when nobody has the app open.
 *
 * Configuration needed at deploy: PRIVATE_POCKETBASE_SUPERUSER_EMAIL /
 * PRIVATE_POCKETBASE_SUPERUSER_PASSWORD / PUBLIC_POCKETBASE_URL must be set in
 * the Netlify environment (the function authenticates as superuser because
 * this is infrastructure, not user traffic — PocketBase rules already gate
 * what tenants can see once charges flip to published).
 */
import { publishDueBills } from '../../src/lib/server/publish.ts';

const { default: PocketBase } = await import('pocketbase');

export default async () => {
	const url = process.env.PUBLIC_POCKETBASE_URL;
	const email = process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
	const password = process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
	if (!url || !email || !password) {
		console.error('publish-scheduled-bills: PocketBase env vars are not configured');
		return;
	}
	const pb = new PocketBase(url);
	await pb.collection('_superusers').authWithPassword(email, password);
	const result = await publishDueBills(pb);
	console.log(`publish-scheduled-bills: ${JSON.stringify(result)}`);
};

// Every 15 minutes — publish_at instants are compared against the real clock,
// so cadence only bounds how soon after the scheduled minute a bill releases.
export const config = { schedule: '*/15 * * * *' };
