/** The wire keys — `$`-synthetic like `$source`: never a field, never persisted (`patchRecord`). */
export declare const REPO_KEY = "$repo";
export declare const DIRTY_KEY = "$dirty";
export declare const AHEAD_KEY = "$ahead";
/** What the engine says of one record: its file (workspace-relative, or absolute outside every repo)
 *  and the repo that commits it — null when none does. */
export interface Located {
    file: string;
    repo: string | null;
}
/** `store.locate(collection, id)` when this engine has it, else null — never a throw for its absence. */
export declare function locateRecord(store: {
    locate?: (c: string, id: string) => Located;
}, collection: string, id: string): Located | null;
/** Drop the cached ahead counts — after a commit, which is the one thing here that moves them. */
export declare function forgetAhead(): void;
/** Commits on HEAD its upstream lacks; null when the branch tracks nothing (no remote to be ahead of). */
export declare function aheadOf(repoAbs: string, now?: number): number | null;
/** Does the file hold changes no commit has — edited, added and never committed, or staged? */
export declare function isDirty(repoAbs: string, fileAbs: string): boolean;
/** The record payload's repo keys: none on an engine that cannot say the repo; `$repo: null` alone
 *  outside every repo; else the repo, whether the file is dirty, and the repo's ahead count. */
export declare function repoStateKeys(root: string, located: Located | null): Record<string, unknown>;
