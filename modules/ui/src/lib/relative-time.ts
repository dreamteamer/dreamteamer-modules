/** Shared "how long ago" formatting — ViewDate's `relative` option and ItemHistory's activity timestamps. */
const DIVISIONS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
	{ unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
	{ unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
	{ unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
	{ unit: 'day', ms: 24 * 60 * 60 * 1000 },
	{ unit: 'hour', ms: 60 * 60 * 1000 },
	{ unit: 'minute', ms: 60 * 1000 },
];

export function relativeTime(date: Date): string {
	const diff = date.getTime() - Date.now();
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

	for (const { unit, ms } of DIVISIONS) {
		if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
	}

	return rtf.format(0, 'minute');
}
