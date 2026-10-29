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

/** App route for a protected inspection signed copy. */
export function signedCopyUrl(record: { id: string; signed_copy: string }): string {
	return `/files/inspections/${encodeURIComponent(record.id)}/${encodeURIComponent(record.signed_copy)}`;
}
