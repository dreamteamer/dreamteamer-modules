export interface ApiResult {
    status: number;
    body: unknown;
}
export declare class ApiFailure extends Error {
    status: number;
    constructor(message: string, status: number);
}
export declare class WorkspaceApi {
    root: string;
    private store;
    private manifestMtime;
    private operatorId;
    /**
     * Called after every successful SYSTEM write — a compile-gated source write, whatever surface made
     * it (a native gesture, the designer, the saved-view panel).
     *
     * ⚠ IT EXISTS BECAUSE THE WEBVIEW'S WRITES DO NOT GO THROUGH A COMMAND. They ride the app's RPC
     * channel straight into `handle()`, so the host learned about them only when the file watcher
     * noticed the recompiled runtime 400 ms later — which is late enough for the tree and the rail to
     * disagree with the pane that just wrote. The watcher stays (a `git checkout` and an agent write
     * move files too); this makes the write's own refresh immediate.
     *
     * The payload is the engine's own result, which carries `commits` — including a commit that landed
     * in ANOTHER repo, for a schema write into a `git_modules/` module. That is a success, not a
     * failure, and the caller reports it as one.
     */
    onSystemWrite: ((result: unknown) => void) | undefined;
    constructor(root: string);
    /** The Activity feed's scope reads in flight (`src/activity.ts` ScopeRead), joined by the pane's
     *  follow-up requests (`settled=N`) so a slow repo's log is started once and filled in when it answers. */
    private activityReads;
    /** The last answer per page (module, limit, offset) and the scopes it was read over. A follow-up
     *  reuses both, so while a slow repo is being read a re-ask costs the host nothing until it answers
     *  (review 2026-10-31: each one rebuilt the page, ~0.33 s of blocking work on a large workspace). */
    private activityPages;
    /** The scopes of one module's history, or of every module's (`moduleScope`) — or, with `source`, only
     *  what one root (a record layer, the workspace's own) holds of it (cr: nested ui-views). */
    private activityScopes;
    /** The Activity feed (`src/activity.ts`): one module's history, or every module's merged. */
    private activity;
    /** Rebuild the Store — after a schema write, or when compile moved the manifest. */
    reload(): void;
    /** Runtime file → the module it was compiled from (`src/module-of.ts`), read from the manifest once
     *  per Store — what `$module` on a schema row says, and what the Schema tab narrows by. */
    private runtimeModulesCache;
    private runtimeModules;
    /** The source context — the root package's `git_modules`, the module records, the `repos` records
     *  and each clone's origin — read once per Store and dropped with it, so a request pays for the
     *  `repos` walk and the `git remote` calls at most once per compile. */
    private sourcesCache;
    private sourcesCtx;
    /** The module a runtime file (under `.dreamteamer/`) was compiled from (`src/module-of.ts`). */
    private runtimeModuleOf;
    /** A collection's NAMED sources: the roots a data kind's records are read from
     *  (`collectionSources`); for a runtime kind — skills, commands, agents — the modules its rows were
     *  compiled from (`runtimeSources`), so every list has the same source picker. */
    private sourcesOf;
    /** The ids more than one root of `d` claims, split into duplicates and stubs (`fsdata.contestedIds`),
     *  reading a contested claimant's `stub` through the engine's own parser. */
    private contested;
    /** The stub roots by id, as source NAMES — what a row's `$stubs` carries. */
    private stubRootNames;
    /** The source one FILE of `d` was read from — its root, or for a runtime kind its module's. */
    private sourceOfFile;
    private mtime;
    /** server.js's per-request freshness check: a `compile` on the side must become visible. */
    private fresh;
    descriptors(): Map<string, any>;
    handle(method: string, rawPath: string, body?: any): Promise<ApiResult>;
    private route;
    /** Turn "unknown collection \"finance\"" into a message that names the real cause. */
    /**
     * Re-open the workspace before a COMPILE-GATED write, and refuse the write when it will not open.
     *
     * ⚠ A system write compiles and commits through `engine().ws`, and that handle is only as current
     * as the last successful open: after a newly declared extension failed to load, a field write
     * compiled and committed the configuration from BEFORE the change (review R5). Browsing a retained
     * handle is fine; generating output from one is not — the same rule the Compile action keeps.
     */
    private currentHandle;
    private hintUnencoded;
    private listRecords;
    private readRecord;
    /**
     * POST /collections/:name/records[?target=<source>] — a new record, in the root the create form chose
     * (cr-vscode-004). No target, or the collection's WRITE root (its first source: the workspace's own,
     * or a module-owned list's clone), is the engine's `add` as ever. A record LAYER is added through the
     * layer's own workspace (`src/layer-write.ts`, the CLI's `dt add -w <layer>`), then the Store is
     * rebuilt so the layered index reads the new file. Anything else — a source the collection does not
     * read, one whose `access` is not `write` — is refused with that source's own reason.
     */
    private createRecord;
    private patchRecord;
    /**
     * THE ROUTING TABLE for a write to a runtime-stored collection. One branch per (kind, verb), and
     * every branch is a single call into the engine's `schema-ops` — the same function the CLI's own
     * interceptor calls for the same verb.
     *
     * ⚠ THIS FILE IS A TRANSPORT. There are no decisions here — not which module a write lands in
     * (the engine resolves that from the manifest's sources), not what a rename touches, not whether
     * an op is legal, not what a refusal says. Three subsystems have already drifted by being
     * hand-copied into this file (`git log`/`git diff`, the `?sort=` comparator, the filter resolver)
     * and each was wrong in both places. If a branch below grows an `if`, the logic belongs in the
     * engine with a verb on it.
     *
     * ⚠ SELECTOR IN THE QUERY STRING, FIELD IN THE BODY (engine §12). `?module=hr` narrows WHICH
     * SOURCE contributes; `{module: "hr"}` in a body is a VALUE BEING WRITTEN — the move. The two
     * spellings mean different things and this router must never blur them. `?dry-run=true` and
     * `?force=true` are selectors by the same rule: they select a plan, or a harder write, rather
     * than naming a value. The engine's own parameter name for the selector is `moduleId`.
     */
    private systemWrite;
    /**
     * `/fields/:collection[/:field]` — the field verbs, which take the collection as their target.
     *
     * ⚠ A FIELD IS NOT A RECORD, so it cannot ride the generic records endpoints: it is the one
     * sub-entity, and it keeps verbs of its own. This path mirrors the CLI's shape (a top-level field
     * verb naming the collection) and it is the path the WEBVIEW already uses to READ fields, so the
     * read and the write finally agree on a spelling.
     *
     * ⚠ AND THE ASYMMETRY THAT LEAVES, stated because it has already cost a debugging session: the
     * host owns `/fields/*` for WRITES and NOT for reads. A GET is answered inside the webview by
     * `api/adapter.ts` out of one cached `/presentation` payload — one payload answers the question
     * for every collection at once — so `GET /fields/:c` against the host is a 404 that reads like a
     * routing bug. Ask `/presentation` and index it by collection.
     */
    private fieldWrite;
    /** A field write is a source write too, so it refreshes and reports on the same terms. */
    private afterFieldWrite;
    private history;
    private historyDiff;
}
export declare function gitHistoryMap(root: string, dirs: string[], repoOf?: (dir: string) => string): Map<string, FileHistory>;
/** One file's history, as a list row carries it: when and by whom it last changed, and who added it. */
export interface FileHistory {
    modified: string | null;
    by: string | null;
    createdBy: string | null;
}
/**
 * `git log --format=%x01%aI%x02%an --name-only` output → each file's history. Newest first, so a
 * file's FIRST sighting is its last change (date and author) and its LAST sighting the commit that
 * added it — who made a record, beside who last touched it (operator 2026-10-29: author and the like
 * as list fields). A rename is not followed: the file "starts" at the rename, the blind spot
 * `last-modified` always had.
 */
export declare function parseGitHistory(out: string, keyOf: (line: string) => string, into?: Map<string, FileHistory>): Map<string, FileHistory>;
/** The wire keys the source rides on — the extension's own, beside `last-modified`. */
export declare const SOURCE_KEY = "$source";
export declare const SOURCE_KIND_KEY = "$source-kind";
/** The roots holding stubs (`stub: true`, engine 0.41.0) that the answering record shadows — names. */
export declare const STUBS_KEY = "$stubs";
/** Who last changed a record, and who added it — `parseGitHistory`, on every list row. */
export declare const MODIFIED_BY_KEY = "$last-modified-by";
export declare const CREATED_BY_KEY = "$created-by";
/** On a runtime kind's row: the module it was compiled from (`src/module-of.ts`). */
export declare const MODULE_KEY = "$module";
export declare const DUPLICATES_KEY = "$duplicates";
