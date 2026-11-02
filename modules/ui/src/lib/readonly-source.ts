/**
 * WHY RESTORE IS UNAVAILABLE ON A RECORD, in one sentence, in ONE place.
 *
 * ⚠ THERE IS NO COLLECTION-LEVEL READ-ONLY ANY MORE. The display contract (descriptor v2, §4.3)
 * carries none, because nothing refuses a whole collection: a runtime kind's records are written
 * through its compile gate by `set`/`rename`/`rm`, and every per-record refusal arrives as the
 * engine's own sentence after the gesture. A banner or badge claiming "read-only" for a collection
 * would be an answer nobody gave.
 *
 * ⚠ `revert` IS STILL REFUSED ON EVERY RUNTIME KIND, and it is the one refusal a surface states
 * BEFORE the click. The engine's reason is structural rather than a policy: a runtime record's bytes
 * are compile's build output in the gitignored runtime, so there is no revision of the RECORD to
 * restore — `history` resolves the module SOURCE instead, and restoring one file of a compiled tree
 * would put the runtime and its source out of step with nothing to detect it.
 */

/** What this module reads off a collection row: the contract's own `runtime` answer. */
export interface RevertSource {
	runtime?: boolean;
}

export function revertRefused(row: RevertSource | null | undefined): boolean {
	return row?.runtime === true;
}

/** Why Restore is unavailable, for a `title`. Empty when it IS available. */
export function revertRefusedSentence(collection: string, row: RevertSource | null | undefined): string {
	if (!revertRefused(row)) return '';
	return `${collection} is compiled — a version of its SOURCE is what git holds, so there is no record revision to restore. Use git on the file under its module.`;
}
