/**
 * A RECORD'S REPO STATE — which repo commits it, whether its file holds changes no commit has, and how
 * far that repo is ahead of its upstream. The record page's sub-header draws it beside the commit line
 * (`<origin> · ahead N · uncommitted`, or `never committed` for a root outside every repo here).
 *
 * The REPO is the engine's answer — `Store#locate`, the same fact `dt get --json` prints as `$repo`
 * (engine after 0.39.1). An engine without it gets NO repo keys at all and the page draws the source
 * alone: guessing the repo here would be a second implementation of the store's own rule. The other
 * two are git's: one `status` per open record, one `rev-list` per repo — cached for a moment, so one
 * page draw (and a burst of them) costs one `rev-list` per repo, and a commit clears it.
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
/** The wire keys — `$`-synthetic like `$source`: never a field, never persisted (`patchRecord`). */
export const REPO_KEY = "$repo";
export const DIRTY_KEY = "$dirty";
export const AHEAD_KEY = "$ahead";
/** `store.locate(collection, id)` when this engine has it, else null — never a throw for its absence. */
export function locateRecord(store, collection, id) {
    if (typeof store?.locate !== "function")
        return null;
    try {
        return store.locate(collection, id);
    }
    catch {
        return null;
    }
}
const AHEAD_TTL_MS = 2000;
const aheadCache = new Map();
/** Drop the cached ahead counts — after a commit, which is the one thing here that moves them. */
export function forgetAhead() {
    aheadCache.clear();
}
const QUIET = { stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 };
/** Commits on HEAD its upstream lacks; null when the branch tracks nothing (no remote to be ahead of). */
export function aheadOf(repoAbs, now = Date.now()) {
    const hit = aheadCache.get(repoAbs);
    if (hit && now - hit.at < AHEAD_TTL_MS)
        return hit.value;
    let value = null;
    try {
        const out = execFileSync("git", ["rev-list", "--count", "@{upstream}..HEAD"], { cwd: repoAbs, ...QUIET }).toString().trim();
        value = /^\d+$/.test(out) ? Number(out) : null;
    }
    catch {
        value = null;
    }
    aheadCache.set(repoAbs, { at: now, value });
    return value;
}
/** Does the file hold changes no commit has — edited, added and never committed, or staged? */
export function isDirty(repoAbs, fileAbs) {
    try {
        const rel = path.relative(repoAbs, fileAbs).split(path.sep).join("/");
        return execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", rel], { cwd: repoAbs, ...QUIET }).toString().trim() !== "";
    }
    catch {
        return false;
    }
}
/** The record payload's repo keys: none on an engine that cannot say the repo; `$repo: null` alone
 *  outside every repo; else the repo, whether the file is dirty, and the repo's ahead count. */
export function repoStateKeys(root, located) {
    if (!located)
        return {};
    if (located.repo === null)
        return { [REPO_KEY]: null };
    const repoAbs = path.resolve(root, located.repo);
    return { [REPO_KEY]: located.repo, [DIRTY_KEY]: isDirty(repoAbs, path.resolve(root, located.file)), [AHEAD_KEY]: aheadOf(repoAbs) };
}
