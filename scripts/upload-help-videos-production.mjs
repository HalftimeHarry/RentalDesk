/**
 * RentalDesk — PRODUCTION help-video uploader (Phase 4 rollout for PR #3).
 *
 * Writes ONLY to the `help_videos` collection: upserts the two approved
 * tutorials by their stable slugs and uploads their MP4/thumbnail/captions.
 * Touches nothing else — no users, leases, payments, inspections, codes.
 *
 * This is deliberately separate from scripts/import-help-videos.mjs, whose
 * local-only target guard stays intact for everyday development.
 *
 * SAFETY:
 *   - DRY RUN by default: prints the plan, performs no writes.
 *   - `--apply` executes; a non-localhost target ADDITIONALLY requires
 *     `--production` (explicit opt-in).
 *   - Idempotent: a record whose metadata matches and whose three file fields
 *     are populated is skipped ("ok"), so reruns never duplicate uploads.
 *
 * Usage:
 *   node --env-file=.env scripts/upload-help-videos-production.mjs                      # dry run
 *   node --env-file=.env scripts/upload-help-videos-production.mjs --apply --production # upload
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const APPLY = process.argv.includes('--apply');
const PRODUCTION_OK = process.argv.includes('--production');

const url = process.env.MIGRATE_PB_URL || process.env.PUBLIC_POCKETBASE_URL;
const adminEmail = process.env.PB_ADMIN_EMAIL || process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const adminPassword = process.env.PB_ADMIN_PASSWORD || process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!url || !adminEmail || !adminPassword) {
	console.error('Missing env: PUBLIC_POCKETBASE_URL (or MIGRATE_PB_URL) and superuser credentials.');
	process.exit(1);
}
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname);
if (APPLY && !isLocal && !PRODUCTION_OK) {
	console.error(`REFUSING: ${url} is not local. Re-run with BOTH --apply and --production to write to it.`);
	process.exit(1);
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const videoRoot = path.join(rootDir, 'videos');

const entries = [
	{
		slug: 'billing-overview',
		title: 'Billing overview',
		description: 'A quick tour of the admin billing dashboard and account status.',
		audience: 'admin',
		placement: 'manage_billing',
		dir: 'billing-overview-2026-10-30',
		files: {
			video_file: 'billing-overview-mobile.mp4',
			thumbnail: 'billing-overview-thumb.jpg',
			captions: 'billing-overview-captions.vtt'
		}
	},
	{
		slug: 'tenant-dashboard-overview',
		title: 'Tenant dashboard overview',
		description: 'A quick walkthrough of the tenant dashboard, key balances, and navigation.',
		audience: 'tenant',
		placement: 'tenant_dashboard',
		dir: 'tenant-dashboard-overview-2026-10-30',
		files: {
			video_file: 'tenant-dashboard-mobile.mp4',
			thumbnail: 'tenant-dashboard-thumb.jpg',
			captions: 'tenant-dashboard-captions.vtt'
		}
	}
];
const MIME = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.vtt': 'text/vtt' };

const pb = new PocketBase(url);
pb.autoCancellation(false);
await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
console.log(`target: ${url}  mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);

const META_KEYS = ['title', 'description', 'audience', 'placement'];
let changes = 0;
for (const e of entries) {
	const existing = await pb
		.collection('help_videos')
		.getFirstListItem(`slug = "${e.slug}"`)
		.catch(() => null);
	const hasAllFiles = !!(existing && existing.video_file && existing.thumbnail && existing.captions);
	const metaMatches =
		!!existing && existing.active === true && META_KEYS.every((k) => existing[k] === e[k]);
	if (existing && hasAllFiles && metaMatches) {
		console.log(`ok       ${e.slug} — record complete, nothing to do`);
		continue;
	}
	changes++;
	const action = existing ? `UPDATE ${e.slug} (fill metadata/files)` : `CREATE ${e.slug} + upload 3 files`;
	if (!APPLY) {
		console.log(`plan     ${action}`);
		continue;
	}
	const fd = new FormData();
	fd.append('slug', e.slug);
	fd.append('title', e.title);
	fd.append('description', e.description);
	fd.append('audience', e.audience);
	fd.append('placement', e.placement);
	fd.append('active', 'true');
	for (const [field, filename] of Object.entries(e.files)) {
		if (existing && existing[field]) continue; // never re-upload an attached file
		const buf = await readFile(path.join(videoRoot, e.dir, filename));
		fd.append(field, new File([buf], filename, { type: MIME[path.extname(filename)] }));
	}
	if (existing) await pb.collection('help_videos').update(existing.id, fd);
	else await pb.collection('help_videos').create(fd);
	console.log(`applied  ${action}`);
}
if (changes === 0) console.log('\nNo changes needed — both tutorials are already in place.');
else if (!APPLY) console.log(`\nDRY RUN complete — ${changes} change(s) WOULD be made. Re-run with --apply to execute.`);
else console.log(`\nDone — ${changes} change(s) applied. Re-run without --apply to verify "ok" for both.`);
