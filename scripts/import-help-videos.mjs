import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';
import { assertSafePocketBaseTarget } from './lib/pocketbase-target-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const videoRoot = path.join(rootDir, 'videos');

const pbUrl = process.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';
assertSafePocketBaseTarget(pbUrl);

const adminEmail = process.env.PB_ADMIN_EMAIL || process.env.PRIVATE_POCKETBASE_SUPERUSER_EMAIL;
const adminPassword = process.env.PB_ADMIN_PASSWORD || process.env.PRIVATE_POCKETBASE_SUPERUSER_PASSWORD;
if (!adminEmail || !adminPassword) {
	console.error('Missing PB admin credentials for the local PocketBase import.');
	process.exit(1);
}

const pb = new PocketBase(pbUrl);
pb.autoCancellation(false);
try {
	await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
} catch {
	await pb.admins.authWithPassword(adminEmail, adminPassword);
}

const entries = [
	{
		slug: 'billing-overview',
		title: 'Billing overview',
		description: 'A quick tour of the admin billing dashboard and account status.',
		audience: 'admin',
		placement: 'manage_billing',
		files: {
			video: 'billing-overview-mobile.mp4',
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
		files: {
			video: 'tenant-dashboard-mobile.mp4',
			thumbnail: 'tenant-dashboard-thumb.jpg',
			captions: 'tenant-dashboard-captions.vtt'
		}
	}
];

const dirMap = {
	'billing-overview': 'billing-overview-2026-10-30',
	'tenant-dashboard-overview': 'tenant-dashboard-overview-2026-10-30'
};

async function loadFile(filePath) {
	const data = await readFile(filePath);
	const type = filePath.endsWith('.mp4') ? 'video/mp4' : filePath.endsWith('.jpg') ? 'image/jpeg' : 'text/vtt';
	return new Blob([data], { type });
}

for (const entry of entries) {
	const dir = path.join(videoRoot, dirMap[entry.slug]);
	const videoPath = path.join(dir, entry.files.video);
	const thumbPath = path.join(dir, entry.files.thumbnail);
	const captionsPath = path.join(dir, entry.files.captions);

	for (const file of [videoPath, thumbPath, captionsPath]) {
		await readFile(file);
	}

	const existing = await pb
		.collection('help_videos')
		.getFirstListItem(`slug = "${entry.slug}"`)
		.catch(() => null);

	const form = new FormData();
	form.append('slug', entry.slug);
	form.append('title', entry.title);
	form.append('description', entry.description);
	form.append('audience', entry.audience);
	form.append('placement', entry.placement);
	form.append('active', 'true');
	form.append('video_file', await loadFile(videoPath), entry.files.video);
	form.append('thumbnail', await loadFile(thumbPath), entry.files.thumbnail);
	form.append('captions', await loadFile(captionsPath), entry.files.captions);

	if (existing) {
		await pb.collection('help_videos').update(existing.id, form);
		console.log(`updated help_videos.${entry.slug}`);
	} else {
		await pb.collection('help_videos').create(form);
		console.log(`created help_videos.${entry.slug}`);
	}
}

console.log('help video import complete');
