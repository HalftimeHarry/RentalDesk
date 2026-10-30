/** Formatting/parsing helpers shared by pages and server code. */

/** Format integer cents as a USD currency string. */
export function formatMoney(cents: number): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/**
 * Format an ISO date string (YYYY-MM-DD or datetime) for display.
 * Calendar-date values — date-only strings or PocketBase datetimes stored at
 * exactly midnight UTC (what date inputs produce) — are rendered as the stored
 * calendar date in UTC, so viewers in any timezone see the same day (no
 * UTC-to-local one-day shift). Real timestamps keep local-time rendering.
 */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—';
	const s = String(iso).trim();
	const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]00:00:00(?:\.\d+)?(?:Z|[+-]00:?00)?)?$/.exec(s);
	if (calendar) {
		const d = new Date(Date.UTC(+calendar[1], +calendar[2] - 1, +calendar[3]));
		return d.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		});
	}
	const d = new Date(s);
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
