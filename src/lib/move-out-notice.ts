/**
 * Move-out notice timing rules, shared by the tenant dialog (picker limits)
 * and the server action (authoritative validation). All calendar math uses
 * Pacific time (America/Los_Angeles) so the "today" a California tenant sees
 * matches what the server enforces.
 */

export const MIN_NOTICE_DAYS = 30;

/** Today's date (YYYY-MM-DD) in Pacific time. */
export function pacificToday(now: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Los_Angeles',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(now);
}

/** Add whole calendar days to a YYYY-MM-DD date (UTC math — no DST drift). */
export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Earliest selectable move-out date: submission day + MIN_NOTICE_DAYS. */
export function earliestMoveOutDate(now: Date = new Date()): string {
	return addDays(pacificToday(now), MIN_NOTICE_DAYS);
}
