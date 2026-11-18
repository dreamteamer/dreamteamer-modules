/** Human-readable byte formatting for the `filesize` display (phase E scope item 2). Pure logic,
 * unit-tested directly (no Vue) — ViewFilesize.vue is the thin UI shell around this. */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * `bytes` → `'1.5 KB'`-style string. Binary (1024) units, matching the `$size` field the server
 * already reports in bytes. Non-finite/negative input (missing/corrupt value) renders as `'—'`
 * rather than throwing — matches the rest of the display set's "never crash the browse table"
 * posture. Sub-1KB values are exact integers (`'512 B'`); 1KB and up get 2 decimals under 10,
 * 1 decimal under 100, and whole numbers at 100+ — enough precision to be useful without noise.
 */
export function formatFilesize(bytes: unknown): string {
	if (bytes === null || bytes === undefined || bytes === '') return '—';
	const n = typeof bytes === 'number' ? bytes : Number(bytes);
	if (!Number.isFinite(n) || n < 0) return '—';
	if (n === 0) return '0 B';

	const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1);
	const value = n / 1024 ** exp;
	const formatted = exp === 0 ? String(value) : value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0);
	return `${formatted} ${UNITS[exp]}`;
}
