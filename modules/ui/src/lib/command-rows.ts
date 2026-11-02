/**
 * ONE ROW OF THE COMMANDS SECTION — the engine's `commandsFor` answer (descriptor v2, §4.1), and the
 * three things the section derives from it. Pure, so the reading of `scope` is a test.
 *
 * A binding joins a command to a collection. `scope: record` gates it per record on the record's own
 * fields — `available_when` makes it available, `done_when` means it has been done — and the engine
 * answers a state per id; `scope: collection` evaluates no record and is always runnable.
 */
export interface CommandRow {
	binding: string;
	command: string;
	name: string;
	description: string;
	'argument-hint': string | null;
	/** Whether the command runs against one record or the whole collection. */
	scope: 'record' | 'collection';
	/** record scope: per-id `available` · `done` · `not-applicable`. */
	states?: Record<string, string>;
	eligible?: string[];
	done?: string[];
	/** The ready-to-paste invocation, covering the eligible ids only; null when none is eligible. */
	invocation: string | null;
}

/** Per-row status: one record reads as a state word, a selection as counts. */
export function commandStatus(row: CommandRow, ids: string[]): string {
	if (row.scope === 'collection') return 'collection';
	const n = ids.length;
	if (n === 0) return 'no record selected';
	if (n === 1) {
		const state = row.states?.[ids[0]!] ?? 'not-applicable';
		return state === 'available' ? 'available' : state === 'done' ? 'done' : 'not applicable';
	}
	const parts = [`${row.eligible?.length ?? 0}/${n} eligible`];
	if (row.done?.length) parts.push(`${row.done.length} done`);
	return parts.join(', ');
}

/** Every record in view already satisfies the binding's `done_when`. */
export function commandAllDone(row: CommandRow, ids: string[]): boolean {
	return row.scope === 'record' && ids.length > 0 && (row.done?.length ?? 0) === ids.length;
}

/** The row's icon: the collection's, a check when it is done everywhere it applies, else a terminal. */
export function commandIcon(row: CommandRow): string {
	if (row.scope === 'collection') return 'dataset';
	return (row.done?.length ?? 0) > 0 && (row.eligible?.length ?? 0) === 0 ? 'check_circle' : 'terminal';
}
