/**
 * Scheduled bill publishing helpers (universal: used by the composer UI and
 * the server actions). Scheduling times are entered and displayed in
 * America/Los_Angeles; storage is always a UTC instant.
 */

const LA = 'America/Los_Angeles';

export interface PublishWindow {
	/** LA wall time bounds for the datetime-local input: 'YYYY-MM-DDTHH:mm'. */
	startWall: string;
	endWall: string;
	/** Human label, e.g. "Nov 20 – Nov 30, 2026". */
	label: string;
}

/**
 * The publication window for a billing month: the 20th through the last day
 * of the PRECEDING month, Los Angeles wall time. December's bill can be
 * scheduled any time from Nov 20 00:00 through Nov 30 23:59 PT.
 */
export function publishWindow(month: string): PublishWindow {
	const [y, m] = month.split('-').map(Number);
	const prev = new Date(y, m - 2, 1); // first of the preceding month
	const py = prev.getFullYear();
	const pm = prev.getMonth();
	const lastDay = new Date(py, pm + 1, 0).getDate();
	const pad = (n: number) => String(n).padStart(2, '0');
	const prevYm = `${py}-${pad(pm + 1)}`;
	const startWall = `${prevYm}-20T00:00`;
	const endWall = `${prevYm}-${pad(lastDay)}T23:59`;
	const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	return {
		startWall,
		endWall,
		label: `${fmt(new Date(py, pm, 20))} – ${fmt(new Date(py, pm, lastDay))}, ${py}`
	};
}

/** True when an LA wall datetime ('YYYY-MM-DDTHH:mm') lies inside the window. */
export function isWithinWindow(month: string, wall: string): boolean {
	const w = publishWindow(month);
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall) && wall >= w.startWall && wall <= w.endWall;
}

/** Minutes America/Los_Angeles is behind UTC at the given instant (480=PST, 420=PDT). */
function laOffsetMinutes(atUtc: Date): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone: LA,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts = Object.fromEntries(
		dtf.formatToParts(atUtc)
			.filter((p) => p.type !== 'literal')
			.map((p) => [p.type, p.value])
	);
	const wallAsUtc = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		Number(parts.hour),
		Number(parts.minute),
		Number(parts.second)
	);
	return (wallAsUtc - atUtc.getTime()) / 60000;
}

/**
 * Convert an LA wall datetime ('YYYY-MM-DDTHH:mm') to a UTC instant in
 * PocketBase's storage format ('YYYY-MM-DD HH:mm:ss.SSSZ'). Two offset passes
 * keep DST boundaries correct.
 */
export function laWallToUtcIso(wall: string): string {
	const naiveUtc = new Date(`${wall}:00Z`);
	// laOffsetMinutes returns (LA wall − true instant), so subtract it to go wall → instant.
	let utc = new Date(naiveUtc.getTime() - laOffsetMinutes(naiveUtc) * 60000);
	utc = new Date(naiveUtc.getTime() - laOffsetMinutes(utc) * 60000);
	return utc.toISOString().replace('T', ' ');
}

/** Format a stored UTC datetime for display in Los Angeles time. */
export function formatLaDateTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString('en-US', {
		timeZone: LA,
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short'
	});
}
