import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isStaff } from '$lib/server/guard';

const MAX_PDF_BYTES = 10_485_760; // matches documents.file maxSize

/**
 * Signed-lease PDF upload. Runs with the signed-in user's own PocketBase
 * client so the documents collection rules are enforced a second time
 * (createRule already restricts kind=signed_lease to owner/admin).
 * Never touches the lease record — dates and status stay untouched.
 * Every upload creates a NEW document record, so earlier signed versions
 * remain linked to the lease as history.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Sign in required.');
	if (!isStaff(user)) error(403, 'Only management can upload the signed lease.');

	const form = await event.request.formData();
	const leaseId = String(form.get('lease') ?? '');
	const file = form.get('file');
	if (!leaseId) error(400, 'Lease is required.');
	if (!(file instanceof File) || file.size === 0) error(400, 'Choose a PDF file to upload.');
	if (file.type !== 'application/pdf') error(400, 'Only PDF files are accepted.');
	if (file.size > MAX_PDF_BYTES) error(400, 'File exceeds the 10 MB limit.');

	// The lease must be visible to this user under the normal rules.
	const lease = await event.locals.pb
		.collection('leases')
		.getOne(leaseId)
		.catch(() => null);
	if (!lease) error(404, 'Lease not found.');

	const payload = new FormData();
	payload.append('owner', user.id);
	payload.append('lease', leaseId);
	payload.append('kind', 'signed_lease');
	payload.append('title', `Signed lease ${new Date().toISOString().slice(0, 10)}`);
	payload.append('file', file, file.name);
	const record = await event.locals.pb
		.collection('documents')
		.create(payload)
		.catch((e: { message?: string }) => {
			error(502, `PocketBase rejected the upload: ${e?.message ?? 'unknown error'}`);
		});

	return json({
		ok: true,
		id: record.id,
		title: record.title,
		file: record.file,
		created: record.created
	});
};
