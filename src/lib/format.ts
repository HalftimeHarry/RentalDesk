/** Formatting/parsing helpers shared by pages and server code. */

/** Format integer cents as a USD currency string. */
export function formatMoney(cents: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Format an ISO date string (YYYY-MM-DD or datetime) for display. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Parse a dollar amount string (e.g. "2250.00") into integer cents. Empty/absent input returns null (means "no override"), not zero. */
export function parseMoneyToCents(value: FormDataEntryValue | null): number | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed === '') return null;
	const n = Number(trimmed.replace(/[$,\s]/g, ''));
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.round(n * 100);
}

/** Normalize a PocketBase datetime ("2026-10-30 00:00:00.000Z") to the YYYY-MM-DD that date inputs require. */
export function toDateInput(value: string | null | undefined): string {
	return value ? String(value).slice(0, 10) : '';
}
