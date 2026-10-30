import { PUBLIC_POCKETBASE_URL } from '$app/env/public';

export { PUBLIC_POCKETBASE_URL };

/** @deprecated Use PUBLIC_POCKETBASE_URL. Kept for the server client. */
export const POCKETBASE_URL = PUBLIC_POCKETBASE_URL;

/** Build the URL for a PUBLIC file (e.g. settings photos on the landing page). */
export function fileUrl(collection: string, recordId: string, filename: string): string {
	return `${PUBLIC_POCKETBASE_URL}/api/files/${collection}/${recordId}/${filename}`;
}

/**
 * App route for PRIVATE document downloads. The server mints a short-lived
 * file token with the signed-in user's permissions and redirects to
 * PocketBase, which enforces the record's viewRule.
 */
export function docUrl(recordId: string, filename: string): string {
	return `/files/documents/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}`;
}

/** True when a stored filename is a previewable image. */
export function isImageFile(filename: string): boolean {
	return /\.(jpe?g|png)$/i.test(filename);
}

/** Maintenance request photo limits — shared by the tenant UI and the server actions. */
export const MAINTENANCE_PHOTO = {
	maxCount: 6,
	maxBytes: 5 * 1024 * 1024, // 5 MB per photo
	accept: 'image/jpeg,image/png,image/webp',
	types: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[]
};

/** Validate a set of maintenance photos against MAINTENANCE_PHOTO. Returns '' or an error. */
export function maintenancePhotoError(files: File[]): string {
	const real = files.filter((f) => f.size > 0);
	if (real.length > MAINTENANCE_PHOTO.maxCount) {
		return `Up to ${MAINTENANCE_PHOTO.maxCount} photos per request.`;
	}
	for (const f of real) {
		if (!MAINTENANCE_PHOTO.types.includes(f.type)) {
			return `"${f.name || 'Photo'}" is not a JPEG, PNG, or WebP image.`;
		}
		if (f.size > MAINTENANCE_PHOTO.maxBytes) {
			return `"${f.name || 'Photo'}" exceeds the 5 MB limit.`;
		}
	}
	return '';
}

/** App route for a protected maintenance-request photo (optional PocketBase thumb). */
export function maintenancePhotoUrl(recordId: string, filename: string, thumb?: string): string {
	return (
		`/files/maintenance_requests/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}` +
		(thumb ? `?thumb=${thumb}` : '')
	);
}

/** App route for a protected inspection signed copy. */
export function signedCopyUrl(record: { id: string; signed_copy: string }): string {
	return `/files/inspections/${encodeURIComponent(record.id)}/${encodeURIComponent(record.signed_copy)}`;
}

/** App route for a protected move-out notice PDF. */
export function noticePdfUrl(recordId: string, filename: string): string {
	return `/files/move_out_notices/${encodeURIComponent(recordId)}/${encodeURIComponent(filename)}`;
}

/** Days between two date-ish strings (date-only precision; negative if b < a). */
export function daysBetween(a: string, b: string): number {
	const ta = new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime();
	const tb = new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime();
	return Math.round((tb - ta) / 86400000);
}
