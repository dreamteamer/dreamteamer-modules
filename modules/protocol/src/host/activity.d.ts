import type { ModuleRecord } from "./fsdata.js";
export interface ActivityRecord {
    collection: string;
    id: string;
    title?: string;
}
export interface ActivityEntry {
    sha: string;
    /** Workspace-relative repo the commit is in — `.` the workspace itself. */
    repo: string;
    /** The repo's NAME (`repoName`) — what the unnarrowed page marks each entry with. */
    source: string;
    author: string;
    date: string;
    subject: string;
    /** The records the commit touched, as many as are named; `files` counts everything it touched. */
    records: ActivityRecord[];
    files: number;
}
export interface ActivityScope {
    repo: string;
    /** Repo-relative pathspecs; empty is the whole repo. */
    paths: string[];
}
/** The repo holding `rel` (workspace-relative): the nearest ancestor with a `.git`, `.` at the top. */
export declare function repoOf(root: string, rel: string): string;
/**
 * The history of a set of record folders (workspace-relative): one scope per repo holding any of them —
 * the workspace's own `data/`, each record layer's clone — with that repo's folders as its pathspecs.
 * What an npm-installed module's page reads (`api.ts`), since the module has no history of its own here.
 */
export declare function recordScopes(root: string, dirs: string[]): ActivityScope[];
/**
 * A module's history: the repo and the pathspecs inside it. `recordDirsOf` gives the workspace-relative
 * record folders of the collections the module ships (only asked for an inline, non-workspace module).
 * Undefined for a module with no git history — an npm install.
 */
export declare function moduleScope(root: string, module: Pick<ModuleRecord, "id" | "path" | "location">, workspaceModule: string | undefined, recordDirsOf: (module: string) => string[]): ActivityScope | undefined;
/**
 * A repo's name, as a source is named (`src/sources.ts`): the workspace's own name for `.`, the
 * clone's `git_modules` key for one under it — the word, and so the dot colour, its records carry.
 */
export declare function repoName(repo: string, workspace: string): string;
/** `git log --format=%x01%H%x02%aI%x02%an%x02%s --name-only` → one entry per commit, files kept as paths. */
export declare function parseActivityLog(out: string, repo: string): Array<Omit<ActivityEntry, "records" | "files" | "source"> & {
    paths: string[];
}>;
/** The first page (operator 2026-10-31: "do a first page (change to 20) limited git query"). */
export declare const ACTIVITY_PAGE = 20;
/** The longest one request waits for a scope before answering without it; the pane names the repo as
 *  still being read and asks again, and the read it started carries on. */
export declare const ACTIVITY_BUDGET_MS = 3000;
/** Once something new is in, how long the rest get to join the same answer — so repos answering
 *  milliseconds apart are one round trip rather than one each. */
export declare const ACTIVITY_GRACE_MS = 150;
/** A `git log` running this long is killed and its repo named as unread, so a hung git never leaves
 *  the page polling forever. */
export declare const ACTIVITY_GIT_TIMEOUT_MS = 60000;
/** How long an ANSWERED read stays for follow-ups to join. A new visit re-reads anyway, so this only
 *  bounds what the host holds after the pane stops asking; expired at the next request, never on a
 *  timer. Its own number, not the kill timeout's, though they happen to agree. */
export declare const ACTIVITY_READ_RETENTION_MS = 60000;
type LogEntries = ReturnType<typeof parseActivityLog>;
/** `git log` for a scope, newest first, `limit` commits — pathspecs made relative to the scope's repo. */
export declare function logArgs(scope: ActivityScope, limit: number): string[];
/**
 * One repo's log for a scope, off the extension host's thread. Nothing when git cannot answer (a repo
 * with no commits yet); a REJECTION only when the log overran `timeoutMs` and was killed, which the
 * feed reports as a repo it could not read.
 */
export declare function readLog(root: string, scope: ActivityScope, limit: number, timeoutMs?: number): Promise<LogEntries>;
/** One page of the feed, and how far its reads have got. */
export interface ActivityPage {
    entries: ActivityEntry[];
    hasMore: boolean;
    /** Repos still being read — the page is the merge of the rest until this is empty. */
    pending: string[];
    /** Repos whose log was killed after `ACTIVITY_GIT_TIMEOUT_MS`. */
    failed: string[];
    /** How many scopes have answered; the asker sends it back to wait for the next. */
    settled: number;
}
/** One scope's log in flight or answered — what the host keeps between a page's first answer and the
 *  requests that fill it in. */
export interface ScopeRead {
    state: "reading" | "done" | "failed";
    entries: LogEntries;
    settled: Promise<void>;
    at: number;
}
/**
 * Several scopes' logs as ONE feed: merged newest first, a commit read from two overlapping scopes
 * once, one PAGE of it (`offset`, `limit`), each file named as a record where it is one (`recordOf`,
 * with its title) and each entry by its repo's name.
 *
 * Paging a merge needs no cursor: the page's entries are among the newest `offset + limit` of SOME
 * scope, so reading that many (and one more, to know whether an older page exists) from each scope
 * and cutting the merge is exact. A page deep in a long history re-reads the pages before it — git
 * walks those in milliseconds, and the page is the only thing named.
 *
 * THE SCOPES ARE READ CONCURRENTLY, and with `budgetMs` / `graceMs` the page need not wait for all of
 * them (operator 2026-10-31: "don't wait for everything to load"): it answers once every scope is in,
 * or once one more than `settled` (what the asker already has) is in and `graceMs` has passed, or at
 * `budgetMs` — naming the repos still `pending` and those `failed`. The reads live in `reads`, so the
 * asker's next request with `settled` JOINS them rather than starting over; a request without it
 * starts fresh. Exact once nothing is pending; until then it is the merge of the repos that answered.
 * Without a budget it waits for every scope. A follow-up handed the `previous` page gets that very
 * page back when nothing has settled since — merging and naming records is the host's real cost.
 */
export declare function activityFeed(root: string, scopes: ActivityScope[], page: {
    limit: number;
    offset: number;
    workspace: string;
    settled?: number;
}, recordOf: (workspaceRel: string) => ActivityRecord | undefined, opts?: {
    read?: (scope: ActivityScope, limit: number) => Promise<LogEntries>;
    reads?: Map<string, ScopeRead>;
    budgetMs?: number;
    graceMs?: number;
    previous?: ActivityPage;
}): Promise<ActivityPage>;
export {};
