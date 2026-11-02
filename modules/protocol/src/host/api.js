// THE CLEAN CONTRACT, WITHOUT THE SERVER (decision 48 — "the prize").
//
// A faithful port of the engine's HTTP routes (`server.js`, which left core for the
// `@dreamteamer/http` extension in engine 0.31.0) with Express taken out: same paths, same query
// handling, same response shapes, same error→status mapping. The webview app calls it over
// postMessage (webview/src/api/transport.ts) instead of over a socket, so its api/adapter.ts —
// and therefore every page, list, edit and view in the app — is untouched by the server's removal.
//
// The route BODIES are all thin calls into the engine's public API (Store / presentation / the
// schema ops), which engine.ts holds. "server.js" in the comments below names that route contract.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { engine, refreshWorkspace } from "./engine.js";
import { listFolderImages } from "./folder-images.js";
import { contestedIds, fileToRecord, loadDescriptors, loadModules, repoOfPath, workspaceModule } from "./fsdata.js";
import { loadRuntimeModules, moduleOfRuntimeFile } from "./module-of.js";
import { ACTIVITY_BUDGET_MS, ACTIVITY_GRACE_MS, ACTIVITY_PAGE, ACTIVITY_READ_RETENTION_MS, activityFeed, moduleScope, recordScopes, repoName } from "./activity.js";
import { recordTitle } from "./titles.js";
import { forgetAhead, locateRecord, repoStateKeys } from "./repo-state.js";
import { collectionSources, moduleSource, runtimeSources, sourceOfFile, sourcesContext, sourcesStack, withoutSourceClauses } from "./sources.js";
import { createInLayer } from "./layer-write.js";
export class ApiFailure extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export class WorkspaceApi {
    root;
    store;
    manifestMtime = 0;
    operatorId = null;
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
    onSystemWrite;
    constructor(root) {
        this.root = root;
        this.reload();
        try {
            const name = execFileSync("git", ["config", "user.name"], { cwd: root }).toString().trim();
            this.operatorId = engine().slugOrHash(name);
        }
        catch {
            /* no git identity — @me filters simply won't narrow (same as the server) */
        }
    }
    /** The Activity feed's scope reads in flight (`src/activity.ts` ScopeRead), joined by the pane's
     *  follow-up requests (`settled=N`) so a slow repo's log is started once and filled in when it answers. */
    activityReads = new Map();
    /** The last answer per page (module, limit, offset) and the scopes it was read over. A follow-up
     *  reuses both, so while a slow repo is being read a re-ask costs the host nothing until it answers
     *  (review 2026-10-31: each one rebuilt the page, ~0.33 s of blocking work on a large workspace). */
    activityPages = new Map();
    /** The scopes of one module's history, or of every module's (`moduleScope`) — or, with `source`, only
     *  what one root (a record layer, the workspace's own) holds of it (cr: nested ui-views). */
    activityScopes(moduleId, source) {
        const eng = engine();
        const store = this.store;
        const modules = loadModules(this.root);
        const ws = workspaceModule(this.root);
        const descs = [...store.descriptors.values()];
        const recordDirsOf = (id) => descs
            .filter((d) => !eng.descriptor.isRuntime(d) && eng.descriptor.moduleOf(d) === id)
            .flatMap((d) => store.recordDirs(d).map((dir) => path.relative(this.root, dir).split(path.sep).join("/")));
        const picked = moduleId ? modules.filter((m) => m.id === moduleId) : modules;
        // narrowed to ONE npm-installed module, its history is its records' (cr: nested ui-views — its page
        // nests this feed); the unnarrowed feed never reads record scopes, so it costs what it always cost
        const npm = (m) => m.location === "node_modules" || (m.path ?? "").split("/").includes("node_modules");
        let scopes = picked.flatMap((m) => {
            const own = moduleScope(this.root, m, ws, recordDirsOf);
            if (own)
                return [own];
            return moduleId && npm(m) ? recordScopes(this.root, recordDirsOf(m.id)) : [];
        });
        // the workspace's own history belongs to "every module" even where no module is the workspace's
        if (!moduleId && !scopes.some((s) => s.repo === "." && !s.paths.length))
            scopes.push({ repo: ".", paths: [] });
        // one root's share: the scopes of the repo that root's NAME is (`repoName`, the source mark's word)
        const workspaceName = this.sourcesCtx().workspace;
        if (source)
            scopes = scopes.filter((s) => repoName(s.repo, workspaceName) === source);
        return scopes;
    }
    /** The Activity feed (`src/activity.ts`): one module's history, or every module's merged. */
    async activity(moduleId, limit, offset, settled, source) {
        const key = `${moduleId ?? ""}\0${source ?? ""}\0${limit}\0${offset}`;
        for (const [k, p] of this.activityPages)
            if (Date.now() - p.at > ACTIVITY_READ_RETENTION_MS)
                this.activityPages.delete(k);
        const last = settled === undefined ? undefined : this.activityPages.get(key);
        const scopes = last?.scopes ?? this.activityScopes(moduleId, source);
        let fsDescs;
        const feed = await activityFeed(this.root, scopes, { limit, offset, workspace: this.sourcesCtx().workspace, settled }, (rel) => {
            const hit = fileToRecord(this.root, (fsDescs ??= loadDescriptors(this.root)), path.join(this.root, rel));
            if (!hit)
                return undefined;
            const title = recordTitle(this.root, hit.d, hit.id);
            return { collection: hit.d.name, id: hit.id, ...(title && title !== hit.id ? { title } : {}) };
        }, { reads: this.activityReads, budgetMs: ACTIVITY_BUDGET_MS, graceMs: ACTIVITY_GRACE_MS, previous: last?.feed });
        if (last && feed === last.feed) {
            last.at = Date.now();
            return last.body;
        }
        const body = { module: moduleId ?? null, ...(source ? { source } : {}), scopes, offset, limit, ...feed };
        this.activityPages.set(key, { at: Date.now(), scopes, feed, body });
        return body;
    }
    /** Rebuild the Store — after a schema write, or when compile moved the manifest. */
    reload() {
        this.store = new (engine().Store)(engine().ws);
        this.manifestMtime = this.mtime();
        this.sourcesCache = null;
        this.runtimeModulesCache = null;
    }
    /** Runtime file → the module it was compiled from (`src/module-of.ts`), read from the manifest once
     *  per Store — what `$module` on a schema row says, and what the Schema tab narrows by. */
    runtimeModulesCache = null;
    runtimeModules() {
        if (!this.runtimeModulesCache) {
            const modules = loadModules(this.root);
            this.runtimeModulesCache = { files: loadRuntimeModules(this.root, modules), ids: new Set(modules.map((m) => m.id)), workspace: workspaceModule(this.root) };
        }
        return this.runtimeModulesCache;
    }
    /** The source context — the root package's `git_modules`, the module records, the `repos` records
     *  and each clone's origin — read once per Store and dropped with it, so a request pays for the
     *  `repos` walk and the `git remote` calls at most once per compile. */
    sourcesCache = null;
    sourcesCtx() {
        return (this.sourcesCache ??= sourcesContext(this.root, this.store.descriptors.values()));
    }
    /** The module a runtime file (under `.dreamteamer/`) was compiled from (`src/module-of.ts`). */
    runtimeModuleOf(file) {
        return moduleOfRuntimeFile(path.relative(path.join(this.root, ".dreamteamer"), file).split(path.sep).join("/"), this.runtimeModules().files);
    }
    /** A collection's NAMED sources: the roots a data kind's records are read from
     *  (`collectionSources`); for a runtime kind — skills, commands, agents — the modules its rows were
     *  compiled from (`runtimeSources`), so every list has the same source picker. */
    sourcesOf(d) {
        if (!engine().descriptor.isRuntime(d))
            return collectionSources(this.root, d, this.sourcesCtx());
        return runtimeSources([...this.store.readAll(d.name)].map(({ file }) => this.runtimeModuleOf(file)), this.sourcesCtx());
    }
    /** The ids more than one root of `d` claims, split into duplicates and stubs (`fsdata.contestedIds`),
     *  reading a contested claimant's `stub` through the engine's own parser. */
    contested(d) {
        const isStub = (file) => {
            try {
                return engine().parseRecordText(fs.readFileSync(file, "utf8"), d)?.stub === true;
            }
            catch {
                return false; // an unreadable claimant is a claim, as the engine treats it
            }
        };
        return contestedIds(this.root, d, isStub);
    }
    /** The stub roots by id, as source NAMES — what a row's `$stubs` carries. */
    stubRootNames(stubs, sources) {
        const out = new Map();
        for (const [id, roots] of stubs) {
            const names = roots.map((r) => sources.find((x) => x.path === path.relative(this.root, r.dir).split(path.sep).join("/"))?.name ?? r.repo);
            out.set(id, [...new Set(names)]);
        }
        return out;
    }
    /** The source one FILE of `d` was read from — its root, or for a runtime kind its module's. */
    sourceOfFile(d, file, sources) {
        if (!engine().descriptor.isRuntime(d))
            return sourceOfFile(this.root, d, file, sources);
        const id = this.runtimeModuleOf(file);
        const name = moduleSource(id ? this.sourcesCtx().modules.find((m) => m.id === id) : undefined, this.sourcesCtx()).name;
        return sources.find((s) => s.name === name);
    }
    mtime() {
        const p = path.join(this.root, ".dreamteamer", "manifest.yaml");
        return fs.existsSync(p) ? fs.statSync(p).mtimeMs : 0;
    }
    /** server.js's per-request freshness check: a `compile` on the side must become visible. */
    fresh() {
        if (this.mtime() !== this.manifestMtime)
            this.reload();
        return this.store;
    }
    descriptors() {
        return this.fresh().descriptors;
    }
    // ---- the router ------------------------------------------------------------------------
    async handle(method, rawPath, body) {
        try {
            return { status: 200, body: await this.route(method, rawPath, body) };
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            // same error contract as server.js's Express error handler
            const status = err instanceof ApiFailure
                ? err.status
                : err instanceof engine().CompileError
                    ? 400
                    : /no such record/.test(msg)
                        ? 404
                        : /referenced by|already exists/.test(msg)
                            ? 409
                            : 400;
            return { status, body: { error: msg } };
        }
    }
    async route(method, rawPath, body) {
        const qIndex = rawPath.indexOf("?");
        const pathname = qIndex === -1 ? rawPath : rawPath.slice(0, qIndex);
        const query = new URLSearchParams(qIndex === -1 ? "" : rawPath.slice(qIndex + 1));
        const seg = pathname.replace(/^\/+/, "").split("/").map(decodeURIComponent);
        const store = this.fresh();
        const eng = engine();
        // --- GET /info -----------------------------------------------------------------------
        if (seg[0] === "info" && method === "GET") {
            const manifest = eng.readManifest(this.root);
            let stale = 0;
            try {
                stale = eng.staleness(this.root)?.stale?.length ?? 0;
            }
            catch { }
            return {
                name: eng.ws.pkg.name,
                host: manifest?.host,
                compiled: manifest?.compiled,
                modules: manifest?.modules ?? [],
                // which module a write with no `?module=` lands in — the Save as… picker's default row
                workspace_module: eng.ws.pkg.dreamteamer?.workspace_module ?? null,
                ui: manifest?.ui ?? [],
                user: this.operatorId,
                stale,
                collections: [...store.descriptors.keys()],
            };
        }
        // --- GET /schema | /presentation -------------------------------------------------------
        if (seg[0] === "schema" && seg.length === 1 && method === "GET") {
            const order = (d) => eng.descriptor.displayOf(d).nav?.order ?? 999;
            return [...store.descriptors.values()].sort((a, b) => order(a) - order(b));
        }
        // The collection rows carry `sources` — every root a collection's records are read from, NAMED
        // (`src/sources.ts`), with the records read from each. The extension's own key on the engine's
        // row (`api/collection-rows.ts` carries it): it is what lets the webview decide, before a single
        // record is fetched, whether a browse is mixed (the Source column on by default), single-foreign
        // (one line under the title) or the workspace's own (nothing drawn, as before).
        if (seg[0] === "presentation" && method === "GET") {
            const p = eng.presentation(store.descriptors);
            const ctx = this.sourcesCtx();
            for (const row of p.collections ?? []) {
                const d = store.descriptor(row.collection);
                if (d)
                    row.sources = this.sourcesOf(d);
            }
            return p;
        }
        // --- GET /sources — the stack the Schema tab's Sources section draws -----------------------
        // Top to bottom, as `dt status` prints its `layers:` block: own data, each declared layer
        // (installed or not, the collections it contributes, record counts), each module-owned
        // collection under its module. Derived from the compiled roots plus `git_modules`; a match on a
        // `repos` record's `url` rides along as `record`, so the webview links the source rather than
        // inventing a reference.
        if (seg[0] === "sources" && seg.length === 1 && method === "GET") {
            return sourcesStack(this.root, [...store.descriptors.values()], this.sourcesCtx());
        }
        // --- GET /activity[?module=<id>&source=<root>&limit=N&offset=N&settled=N] — the Schema tab's Activity page
        // (`src/activity.ts`): git history as named entries — who, when, the message, the records
        // touched, the repo — for one module, or for every module when none is named; one page of it,
        // with `hasMore` saying whether an older page exists. Answered before the slowest repo is in:
        // `pending` names the repos still being read, and the pane asks again with `settled` (what it
        // has) until none is
        if (seg[0] === "activity" && seg.length === 1 && method === "GET") {
            const offset = Math.max(0, Math.floor(Number(query.get("offset") ?? 0)) || 0);
            const settled = query.has("settled") ? Math.max(0, Math.floor(Number(query.get("settled"))) || 0) : undefined;
            return this.activity(query.get("module") ?? undefined, Math.min(Number(query.get("limit") ?? ACTIVITY_PAGE) || ACTIVITY_PAGE, 500), offset, settled, query.get("source") || undefined);
        }
        // --- field writes: `/fields/:collection[/:field]` ---------------------------------------
        //
        // ⚠ A FIELD IS NOT A RECORD, so it cannot ride the generic records endpoints — it is the one
        // sub-entity, and it keeps verbs of its own. This path mirrors the CLI's shape (a top-level
        // field verb taking the collection as its target) and it is the path the WEBVIEW already uses
        // to READ fields, so the read and the write finally agree on a spelling.
        //
        // ⚠ AND THE ASYMMETRY THAT LEAVES, stated because it has already cost a debugging session:
        // the host owns `/fields/*` for WRITES and NOT for reads. A GET is answered inside the webview
        // by `api/adapter.ts` out of one cached `/presentation` payload — one payload answers the
        // question for every collection at once — so `GET /fields/:c` against the host is a 404 that
        // reads like a routing bug. Ask `/presentation` and index it by collection.
        if (seg[0] === "fields" && method !== "GET") {
            await this.currentHandle();
            const out = this.fieldWrite(method, seg.slice(1), query, body);
            this.reload();
            return this.afterFieldWrite(out, query.get("dry-run") === "true");
        }
        // --- GET /folder/:collection/:id?field=… -----------------------------------------------------
        //
        // The images a record's FOLDER TEMPLATE field points at, rendered for this machine and listed
        // naturally sorted. The webview cannot read the disk or the environment; it gets back the
        // rendered folder path (to map onto a `__DT_VAR_ROOTS__` uri) and the file names. A folder that
        // is not there, or a variable that is not set, is answered with a message the layout shows —
        // an empty carousel with no reason is indistinguishable from "no screenshots".
        if (seg[0] === "folder" && method === "GET") {
            const collection = seg[1] ?? "";
            const id = seg.slice(2).join("/");
            const field = query.get("field") ?? "";
            if (!collection || !id || !field)
                throw Object.assign(new Error("GET /folder/:collection/:id?field=<name>"), { status: 400 });
            this.hintUnencoded(seg, collection);
            const { fields } = store.read(collection, id);
            const template = fields?.[field];
            if (typeof template !== "string" || !template)
                return { path: null, files: [], reason: `${field} is empty on this record` };
            let dir;
            try {
                dir = eng.renderEnv(template);
            }
            catch (e) {
                return { path: null, files: [], reason: String(e?.message ?? e) };
            }
            if (dir.includes("${"))
                return { path: null, files: [], reason: `a variable in ${template} is not set on this machine` };
            const files = listFolderImages(dir);
            return { path: dir, files, reason: files.length ? null : `no images in ${dir}` };
        }
        // --- /collections/:name/... -------------------------------------------------------------
        if (seg[0] === "collections") {
            const name = seg[1] ?? "";
            // ⚠ A collection name may contain a slash (`finance/accounts`) and `seg[1]` is ONE segment,
            // so every caller must percent-encode it. When one does not, the name arrives truncated at
            // the first slash and the store's error names a collection nobody wrote — "unknown
            // collection \"finance\"" — which sent a real debugging session looking at the engine.
            // Fail the same way, but say WHY: if joining the following segments names a real
            // collection, the caller forgot to encode. `url-encoding.test.ts` is the guard that stops
            // this reaching a build; this is the message for when it does anyway.
            this.hintUnencoded(seg, name);
            const tail = seg[2] ?? "";
            const id = seg.slice(3).join("/");
            // ⚠ IS THIS COLLECTION THE SCHEMA? A runtime-stored collection — `modules`, `collections`,
            // `skills`, `agents`, `commands`, `command-bindings`, `ui-views`, `mixins` — is
            // written by editing SOURCES behind a compile gate, not by the record layer, whose refusal of
            // such a write stays exactly where it is. Same verbs, same paths, different implementation
            // underneath: that is the whole of "system entities are collections".
            //
            // ⚠ IT ASKS `isRuntime`, AND IT DELIBERATELY DISAGREES WITH `nav.ts`, WHICH ASKS
            // `isInternal`. The two are asking different questions and only look alike. This line
            // decides HOW A WRITE IS PERFORMED — the paragraph above is its own argument for that: a
            // source edited behind a compile gate is a STORAGE fact, and `compiled.runtime` is what
            // states it. `nav.ts` decides WHERE THE COLLECTION IS DRAWN, which is a presentation fact and
            // is what `internal: true` states. `repos` is the collection where the two split — plumbing
            // (drawn on the schema surface) whose records are workspace-stored and edited by
            // hand — and routing its writes by `internal` sends them to `systemWrite`, whose
            // engine entity ops are indexed by a closed set of runtime kinds that does not contain
            // `repos`: the shape comes back undefined and the write dies as `Cannot read properties of
            // undefined`. Measured; `api-namespaced-routes.test.ts` is the guard.
            const descriptor = store.descriptor(name);
            const writtenAsSource = descriptor ? eng.descriptor.isRuntime(descriptor) : false;
            if (writtenAsSource && method !== "GET")
                await this.currentHandle();
            // ⚠ THE RECORD LAYER HAS NO DRY RUN, AND A PLANNER MUST NOT BE ANSWERED WITH A WRITE.
            // `schema-crud.ts` plans every destructive gesture by re-issuing it with `?dry-run=true`,
            // shows the engine's plan, and only then asks. `systemWrite` honours that — it answers a
            // null plan for any op the engine cannot plan — but the record verbs below never read the
            // flag, so the "plan" call would perform the rename or the delete and the confirmed call
            // would fail with "no such record": the write landing BEFORE the question, and then
            // reported as a refusal. Answer the same null plan the system path answers, which
            // `planLine` already renders as NO_PLAN.
            //
            // Unreachable until `repos`: a collection is planned-then-written only from the Schema
            // surface, and until a collection could be in the `system` partition while its records
            // stayed workspace-stored, everything drawn there was written as a source.
            if (!writtenAsSource && method !== "GET" && query.get("dry-run") === "true") {
                return { plan: null, "dry-run": "unsupported" };
            }
            // GET /collections/:name/values/:field — the field's real vocabulary, for filter dropdowns
            if (tail === "values" && method === "GET") {
                const field = seg.slice(3).join("/");
                // `$source` is the extension's own column, so its vocabulary is answered here, in the
                // same shape `distinctValues` answers a field's: the roots that hold records, by name.
                if (field === SOURCE_KEY) {
                    const values = this.sourcesOf(descriptor).filter((x) => x.count > 0).map((x) => ({ value: x.name, count: x.count }));
                    return { collection: name, field, values, total: values.length, truncated: false };
                }
                // the other computed fields (`$module`, `$last-modified-by`, `$created-by`) are no field of the
                // engine's either: their vocabulary is counted off the rows the list itself stamps
                if (field.startsWith("$")) {
                    const counts = new Map();
                    const all = this.listRecords(name, new URLSearchParams({ limit: String(Number.MAX_SAFE_INTEGER) })).records;
                    for (const r of all)
                        if (typeof r[field] === "string" && r[field])
                            counts.set(r[field], (counts.get(r[field]) ?? 0) + 1);
                    const values = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, count]) => ({ value, count }));
                    return { collection: name, field, values, total: values.length, truncated: false };
                }
                const limitParam = query.get("limit");
                return eng.distinctValues(store, name, field, {
                    limit: limitParam === null ? undefined : Number(limitParam),
                });
            }
            if (tail === "records") {
                if (id === "") {
                    if (method === "GET")
                        return this.listRecords(name, query);
                    if (method === "POST")
                        return writtenAsSource ? this.systemWrite("add", name, "", query, body) : this.createRecord(name, body, query.get("target"));
                }
                else {
                    if (method === "GET")
                        return this.readRecord(name, id);
                    if (method === "PATCH")
                        return writtenAsSource ? this.systemWrite("set", name, id, query, body) : this.patchRecord(name, id, body);
                    if (method === "DELETE") {
                        if (writtenAsSource)
                            return this.systemWrite("rm", name, id, query, body);
                        store.rm(name, id, { force: query.get("force") === "true" });
                        return { id };
                    }
                }
            }
            // POST /collections/:name/files — import a file AS a record (`storage.format: binary`).
            // A separate verb from `records` because the body is a PATH, not fields: there is nothing
            // to validate and nothing to serialize, which is why the engine keeps `addFile` a sibling
            // of `add` rather than a branch inside it.
            if (tail === "files" && method === "POST") {
                const { id: fileId, from, force } = body ?? {};
                if (!fileId || !from)
                    throw new Error("a file record needs both an id and a `from` path");
                const written = store.addFile(name, String(fileId), String(from), { force: force === true });
                return { id: written.id, path: path.relative(this.root, written.file) };
            }
            // PATCH /collections/:name/position/:id — manual ordering (`dt reorder`). ONE record is written.
            //
            // The key comes from the WORKSPACE's engine (`placementKey`), never from a copy in this repo:
            // the a-z alphabet it generates has to agree with the `compareValues` that sorts it, and a
            // second implementation that drifts produces a silently wrong order rather than an error. The
            // field it writes is the collection's one `type: position` field, asked of the engine too.
            if (tail === "position" && method === "PATCH") {
                const d = store.descriptor(name);
                const field = d ? eng.descriptor.positionFieldOf(d) : undefined;
                if (!field)
                    throw new ApiFailure(`collection "${name}" has no \`type: position\` field — nothing to reorder by`, 400);
                const rows = [];
                for (const r of store.readAll(name))
                    rows.push({ id: r.id, key: r.fields[field] ?? "" });
                eng.sortRows(rows, "key");
                try {
                    store.set(name, id, { [field]: eng.placementKey(rows, id, body ?? {}, name) });
                }
                catch (e) {
                    throw new ApiFailure(String(e?.message ?? e), 400);
                }
                return { id };
            }
            if (tail === "rename" && method === "POST") {
                if (writtenAsSource)
                    return this.systemWrite("rename", name, String(body?.old ?? ""), query, body);
                return store.rename(name, body?.old, body?.new);
            }
            if (tail === "records-revert" && method === "POST")
                return store.revert(name, id, String(body?.hash ?? ""));
        }
        // --- bound commands + per-record state (Commands tab) — GET /commands/:collection?ids=… ---
        if (seg[0] === "commands" && seg.length === 2 && method === "GET") {
            const ids = (query.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            return eng.commandsFor(store, seg[1], ids);
        }
        // --- POST /commit — publish the record writes already on disk (engine `dt commit`) --------
        // Body: { only?: string[], message?: string, dryRun?: boolean }; `dryRun` is what the header
        // gesture polls for its pending count. Transport only — the sampling, the subject and every
        // git call belong to commit.js, which is why there is no `git` in this route.
        if (seg[0] === "commit" && seg.length === 1 && method === "POST") {
            if (body?.dryRun !== true)
                forgetAhead(); // a commit moves the ahead counts
            return eng.commitPending(store, {
                only: Array.isArray(body?.only) ? body.only : [],
                message: typeof body?.message === "string" ? body.message : undefined,
                dryRun: body?.dryRun === true,
            });
        }
        // --- git-backed history -----------------------------------------------------------------
        if (seg[0] === "history" && method === "GET")
            return this.history(seg[1] ?? "", seg.slice(2).join("/"));
        if (seg[0] === "history-diff" && method === "GET")
            return this.historyDiff(seg[1] ?? "", seg.slice(2).join("/"), query.get("hash") ?? "HEAD");
        if (seg[0] === "reload" && method === "POST") {
            this.reload();
            return { ok: true };
        }
        throw new ApiFailure(`unhandled request ${method} ${rawPath}`, 404);
    }
    /** Turn "unknown collection \"finance\"" into a message that names the real cause. */
    /**
     * Re-open the workspace before a COMPILE-GATED write, and refuse the write when it will not open.
     *
     * ⚠ A system write compiles and commits through `engine().ws`, and that handle is only as current
     * as the last successful open: after a newly declared extension failed to load, a field write
     * compiled and committed the configuration from BEFORE the change (review R5). Browsing a retained
     * handle is fine; generating output from one is not — the same rule the Compile action keeps.
     */
    async currentHandle() {
        try {
            await refreshWorkspace();
        }
        catch (e) {
            throw new ApiFailure(`the workspace's current configuration did not load, so nothing was written: ${e?.message ?? e}`, 409);
        }
    }
    hintUnencoded(seg, name) {
        if (!name || this.store.descriptors.has(name))
            return;
        for (let take = seg.length; take > 2; take--) {
            const candidate = seg.slice(1, take).join("/");
            if (!this.store.descriptors.has(candidate))
                continue;
            throw new ApiFailure(`unknown collection "${name}" — did you mean "${candidate}"? `
                + `a collection name containing "/" must be percent-encoded in the URL `
                + `(encodeURIComponent("${candidate}")), or it splits into extra path segments.`, 404);
        }
    }
    // ---- records ------------------------------------------------------------------------------
    listRecords(name, query) {
        const store = this.store;
        const eng = engine();
        const d = store.descriptor(name);
        const bf = eng.bodyField(d);
        // every folder the collection's records can sit in — a collection stored under another
        // (`storage.under`) keeps most of its files inside the parent's folders, which its own root
        // never reaches
        // …and each folder is asked of the repo that HOLDS it: a module-owned collection and a record
        // layer keep their records in another clone, whose history the workspace's git cannot see
        const descriptors = [...store.descriptors.values()];
        const history = gitHistoryMap(this.root, store.recordDirs(d), (dir) => repoOfPath(this.root, descriptors, dir));
        // `created` (descriptor v2, §3.6) for EVERY row, before the filter and the sort can ask for it:
        // the stamp when the file has one, else the engine's lazy read (`createdOf`) — the id's date, or
        // when the file first entered history. That read goes through `Store#addedDates`, ONE `git log`
        // for the whole collection, cached per Store, so a list of pre-stamp records costs one git call,
        // not one per row. Never backfilled: it rides on the payload only.
        // `$source` per row — the NAME of the root the record was read from (`src/sources.ts`) — and
        // `$duplicates` on an id more than one root holds (the write root's copy is the one read; the
        // losers are `check`'s violation, surfaced here so the row can warn). `$`-prefixed like
        // `$last-modified-by`: synthetic, never a field, never persisted by the adapter.
        const sources = this.sourcesOf(d);
        const contested = this.contested(d);
        const dupes = contested.duplicates;
        // every row says which MODULE it belongs to — what the Schema tab narrows by when it is opened on
        // one module from the nav: a runtime kind's row, the module it was compiled from; a data record,
        // the module its root belongs to (a layer attached as a module, a module-owned list's module, the
        // workspace module for the workspace's own data)
        const runtime = eng.descriptor.isRuntime(d);
        const mods = this.runtimeModules();
        const moduleOfRow = (file, source) => {
            const id = runtime
                ? this.runtimeModuleOf(file)
                : source?.kind === "own"
                    ? mods.workspace
                    : source && mods.ids.has(source.name)
                        ? source.name
                        : undefined;
            return id ? { [MODULE_KEY]: id } : {};
        };
        // STUBS (engine 0.41.0): a record carrying `stub: true` yields to any non-stub of its id in any root,
        // so the row shown is the non-stub and the stubs are SHADOWED. Each row names the roots holding the
        // stubs it shadows — `$stubs`, drawn beside its mark as `● <root> stub · yields to <its root>`
        // (cr-vscode-004, line 9). Derived from the roots with `contested` above (the Store's own memo is
        // not declared API); and a stub beside a non-stub is no longer a `$duplicates` warning.
        const stubsById = this.stubRootNames(contested.stubs, sources);
        let rows = [];
        for (const { id, file, fields } of store.readAll(name)) {
            const created = fields.created === undefined ? store.createdOf(name, id, fields, file) : undefined;
            const dupe = dupes.get(id);
            // record id WINS over any schema field named "id" (server.js)
            rows.push({
                ...fields,
                ...(created !== undefined ? { created } : {}),
                id,
                ...historyKeys(history.get(path.relative(this.root, file))),
                ...sourceKeys(this.sourceOfFile(d, file, sources)),
                ...moduleOfRow(file, this.sourceOfFile(d, file, sources)),
                ...(dupe ? { [DUPLICATES_KEY]: dupe.map((r) => sources.find((x) => x.path === path.relative(this.root, r.dir).split(path.sep).join("/"))?.name ?? r.repo) } : {}),
                ...(stubsById.get(id)?.length ? { [STUBS_KEY]: stubsById.get(id) } : {}),
            });
        }
        const filter = query.get("filter");
        // what the source picker counts over: the rows every OTHER rule leaves (see below)
        let facetRows;
        if (filter) {
            const f = JSON.parse(filter);
            // ⚠ The RESOLVER is not optional. `matchesFilter` treats any non-operator key as a hop to a
            // referenced record, and resolves it through this callback — with none wired it fails CLOSED,
            // so `{person:{name:{_eq:…}}}` matched NOTHING here while the identical filter worked from the
            // CLI and from the engine's own server, both of which pass one. Third time this file has
            // drifted from server.js by omission (history, then the sort comparator): it is a TRANSPORT.
            const resolve = eng.recordResolver(store);
            const unsourced = withoutSourceClauses(f);
            if (unsourced !== f)
                facetRows = unsourced === undefined ? rows : rows.filter((r) => eng.matchesFilter(r, unsourced, resolve));
            rows = rows.filter((r) => eng.matchesFilter(r, f, resolve));
        }
        // simple equality: filter[field]=value or bare field=value (everything not a known param), then
        // the free-text search — applied alike to the rows and to the picker's count rows
        const KNOWN = new Set(["limit", "offset", "sort", "q", "filter", "with-body"]);
        const q = query.get("q")?.toLowerCase();
        const narrow = (list) => {
            for (const [k, v] of query.entries()) {
                if (KNOWN.has(k))
                    continue;
                const key = k.startsWith("filter[") ? k.slice(7, -1) : k;
                list = list.filter((r) => String(r[key] ?? "") === String(v));
            }
            return q ? list.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : list;
        };
        rows = narrow(rows);
        // The SCHEMA rides along so an enum field sorts by its declared order (engine 0.33.0), exactly as
        // `dt list --sort` does; without it a status column read `active, done, draft`.
        eng.sortRows(rows, query.get("sort"), eng.descriptor.jsonSchemaOf(d));
        const total = rows.length;
        // the source picker's counts: every source of the collection, counted over the filtered rows
        // before the page is cut — a count that followed the page would change as you scrolled — and
        // over what the OTHER rules leave, so picking project-a does not make project-b read 0. Search
        // and the simple equality params apply to both.
        const facet = new Map(sources.map((x) => [x.name, 0]));
        for (const r of facetRows ? narrow(facetRows) : rows)
            facet.set(r[SOURCE_KEY], (facet.get(r[SOURCE_KEY]) ?? 0) + 1);
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? 200);
        rows = rows.slice(offset, offset + limit);
        if (bf && query.get("with-body") !== "true")
            for (const r of rows)
                delete r[bf];
        return { records: rows, total, sources: sources.map((x) => ({ ...x, count: facet.get(x.name) ?? 0 })) };
    }
    readRecord(name, id) {
        const { fields, file } = this.store.read(name, id);
        const commit = gitLastCommit(this.root, file);
        // `created` (descriptor v2, §3.6) is stamped at `dt add`; a record written before the stamp
        // existed has none in its file, and the engine READS it lazily — from the id's date, else the
        // first commit holding the file. Never backfilled, so it rides on the payload only — the same
        // read `listRecords` makes for every row.
        const created = this.store.createdOf(name, id, fields, file);
        const d = this.store.descriptor(name);
        const sources = this.sourcesOf(d);
        const contested = this.contested(d);
        const dupe = contested.duplicates.get(id);
        const stubs = this.stubRootNames(contested.stubs, sources).get(id);
        return {
            id,
            fields: {
                ...fields,
                ...(created !== undefined ? { created } : {}),
                ...lastModifiedKeys(commit?.date ?? null),
                "$last-modified-by": commit?.author ?? null,
                "$last-commit-message": commit?.message ?? null,
                ...sourceKeys(this.sourceOfFile(d, file, sources)),
                // the repo that commits it, uncommitted changes, ahead of upstream — absent on an engine
                // without `Store#locate` (0.39.1 and older), where the page draws the source alone
                // (a compiled kind's file is build output: its repo state is its SOURCE's, not this file's)
                ...(engine().descriptor.isRuntime(d) ? {} : repoStateKeys(this.root, locateRecord(this.store, name, id))),
                // a compiled kind's record says which MODULE it was compiled from, as its list rows do — the
                // one fact a ui-view's record page needs to offer moving it
                ...(engine().descriptor.isRuntime(d) && this.runtimeModuleOf(file) ? { [MODULE_KEY]: this.runtimeModuleOf(file) } : {}),
                ...(dupe ? { [DUPLICATES_KEY]: dupe.map((r) => sources.find((x) => x.path === path.relative(this.root, r.dir).split(path.sep).join("/"))?.name ?? r.repo) } : {}),
                ...(stubs?.length ? { [STUBS_KEY]: stubs } : {}),
            },
            path: path.relative(this.root, file),
        };
    }
    /**
     * POST /collections/:name/records[?target=<source>] — a new record, in the root the create form chose
     * (cr-vscode-004). No target, or the collection's WRITE root (its first source: the workspace's own,
     * or a module-owned list's clone), is the engine's `add` as ever. A record LAYER is added through the
     * layer's own workspace (`src/layer-write.ts`, the CLI's `dt add -w <layer>`), then the Store is
     * rebuilt so the layered index reads the new file. Anything else — a source the collection does not
     * read, one whose `access` is not `write` — is refused with that source's own reason.
     */
    async createRecord(name, body, target) {
        const { id: explicitId, ...fields } = body ?? {};
        const d = this.store.descriptor(name);
        const sources = d ? this.sourcesOf(d) : [];
        const chosen = target ? sources.find((s) => s.name === target) : undefined;
        if (target && !chosen)
            throw new ApiFailure(`${name} reads no source named ${target} — nothing was written.`, 400);
        if (chosen && chosen.access !== "write")
            throw new ApiFailure(`${chosen.note ?? `${target} takes no new record from here`} — nothing was written.`, 400);
        if (!chosen || chosen === sources[0]) {
            const { id, file } = this.store.add(name, fields, { id: explicitId });
            return { id, path: path.relative(this.root, file), source: sources[0]?.name ?? null };
        }
        if (chosen.kind !== "layer")
            throw new ApiFailure(`${target} is not where a new ${name} record is written from here — nothing was written.`, 400);
        const { id, file } = await createInLayer(this.root, chosen.name, name, fields, explicitId);
        this.reload(); // the layered index was built before the file existed in the layer's clone
        return { id, path: path.relative(this.root, file), source: chosen.name };
    }
    patchRecord(name, id, body) {
        // clients echo synthetic response keys back on save — never persist any of them (server.js)
        const { id: _id, path: _path, "last-modified": _lm, last_modified: _lm2, ...rest } = body ?? {};
        // …and every `$`-prefixed key: `$last-modified-by`, `$last-commit-message`, `$source`,
        // `$source-kind`, `$duplicates` — synthetic on the way out, never a field on the way in
        const changes = Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith("$")));
        this.store.set(name, id, changes);
        return { id };
    }
    // ---- system writes: compile-gated, committed, Store reloaded --------------------------------
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
    systemWrite(verb, kind, id, query, body) {
        const { schema, ws } = engine();
        const store = this.store;
        const b = body ?? {};
        const moduleId = query.get("module") ?? undefined;
        const force = query.get("force") === "true";
        const dryRun = query.get("dry-run") === "true";
        const op = opOf(schema, kind, verb);
        // ⚠ A DRY RUN MUST NEVER WRITE, and only three ops take one: `rm modules/…`, the collection
        // MOVE, and `rename-field` (plus `remove-field`, whose plan is a separate read-only export —
        // see `fieldWrite`). Passing `dryRun` to an op that does not read it would PERFORM the write
        // and report it as a plan, so anything else answers a NULL plan instead: the caller then asks
        // its question without a count rather than being handed one nobody computed. The set is
        // declarative on purpose — it is a fact about the engine's verb table, not a decision.
        if (dryRun && !DRY_RUNNABLE.has(`${kind}:${verb}`)) {
            return { plan: null, "dry-run": "unsupported" };
        }
        const out = (() => {
            switch (`${kind}:${verb}`) {
                // ---- modules -----------------------------------------------------------------------
                case "modules:add":
                    return op("createModule")(ws, store, { name: b.name, description: b.description });
                case "modules:set":
                    return op("setModule")(ws, store, id, b);
                case "modules:rename":
                    return op("renameModule")(ws, store, b.old, b.new);
                case "modules:rm":
                    return op("removeModule")(ws, store, id, { force, dryRun });
                // ---- collections -------------------------------------------------------------------
                case "collections:add":
                    // `mixins` (`--mixins docs,…`) and `idFrom` (`--id-from '{{ … }}'`) are the v2 spellings
                    // of what a collection starts from and how its ids are made.
                    return op("createCollection")(ws, store, {
                        name: b.name,
                        mixins: b.mixins,
                        idFrom: b.idFrom,
                        namespace: b.namespace,
                        description: b.description,
                        suffix: b.suffix,
                        moduleId,
                    });
                // THE MOVE is `module` as a FIELD — `dt set collections/<n> module=hr`. Every other key
                // is an ordinary set by its v2 path (`description`, `use_when`, `display.nav.icon`,
                // `display.nav.order`, …), and `display.nav.order` being one of them is why nav position
                // needs no bespoke verb.
                case "collections:set":
                    // a dry run plans only the MOVE; any other set has no planner, so it is the null plan, never
                    // the write (same issue as the field add and edit above)
                    if (dryRun && b.module === undefined)
                        return { plan: null, "dry-run": "unsupported" };
                    return b.module !== undefined
                        ? op("moveCollection")(ws, store, id, String(b.module), { dryRun })
                        : op("setCollectionScalars")(ws, store, id, b, { moduleId });
                case "collections:rename":
                    return op("renameCollection")(ws, store, b.old, b.new);
                case "collections:rm":
                    return op("removeCollection")(ws, store, id, { force });
                // ---- ui-views ----------------------------------------------------------------------
                // A view is an ordinary record conceptually and a SYSTEM-stored one in fact, so it goes
                // through `saveUiView`'s compile gate rather than the record store.
                //
                // ⚠ The bespoke `{id, view}` WRAPPER is gone from the wire — a ui-view is written like
                // any other record, `id` alongside the fields — so all that is left of it is the one
                // line that lifts the id back out of the body. `saveUiView` is an UPSERT, which is why
                // POST is routed to it rather than to a generic `add`: "Save as view" saves an existing
                // view as often as a new one, and `add` on an existing id is a collision.
                // With no `id` in the body the engine's own rule names it — `{{ route | slug }}`, what
                // `dt add ui-views --route …` derives — so a view saved here and one saved from the CLI
                // land on the same record.
                case "ui-views:add": {
                    const { id: viewId, ...view } = b;
                    return op("saveUiView")(ws, store, { id: viewId ?? engine().slug(String(view.route ?? "")), view, moduleId });
                }
                // A PATCH edits what the record already says, exactly as `dt set ui-views/<id> k=v`
                // does: read it through the store, apply the change, save the whole view. A DOTTED key
                // is a position inside a block (`display.nav.order`), as on the CLI; `compiled` is
                // compile's and never goes back into a source.
                //
                // `module` in the body is the MOVE (`dt set ui-views/<id> module=<m>`), exactly as it is for a
                // collection: the source changes module through the compile gate, nothing else changes. An
                // engine without `moveUiView` (before the one that ships it) is refused by `op` with the
                // export named. A move and a key write are two writes, as on the CLI.
                case "ui-views:set": {
                    if (b.module !== undefined) {
                        const { module: to, ...rest } = b;
                        if (Object.keys(rest).length)
                            throw new ApiFailure(`module moves the view to another module; the other keys rewrite it — send them as two writes (${Object.keys(rest).join(", ")})`, 400);
                        return op("moveUiView")(ws, store, id, String(to), { dryRun });
                    }
                    // only the move plans; a key write reads no `dryRun` and would PERFORM itself
                    if (dryRun)
                        return { plan: null, "dry-run": "unsupported" };
                    const current = JSON.parse(JSON.stringify(store.read("ui-views", id).fields));
                    delete current.id; // the id is the filename, never a body key
                    delete current.compiled;
                    for (const [k, v] of Object.entries(b))
                        setDotted(current, k, v);
                    return op("saveUiView")(ws, store, { id, view: current });
                }
                case "ui-views:rm":
                    return op("removeUiView")(ws, store, id);
                // ---- skills · agents · commands · command-bindings · mixins ------------------------
                // The ENGINE owns which of these `add` refuses and why — they are hand-authored, and
                // `refuseHandAuthored` throws the sentence that names the path to write. That is the
                // whole reason this router does not need a list of them, and the reason a kind the
                // engine later grows `add` for needs no change here.
                case "skills:add":
                    return op("createSkill")(ws, store, { name: b.name, description: b.description, moduleId });
                default:
                    switch (verb) {
                        case "add":
                            return op("refuseHandAuthored")(ws, store, kind, b.name, moduleId);
                        case "set":
                            return op("setEntityFrontmatter")(ws, store, kind, id, b);
                        case "rename":
                            return op("renameEntity")(ws, store, kind, b.old, b.new);
                        case "rm":
                            return op("removeEntity")(ws, store, kind, id);
                    }
            }
        })();
        // A system write compiles and COMMITS, so the Store this instance holds is looking at the
        // previous runtime until it is rebuilt. The old `/schema/*` branch did this at the dispatch;
        // doing it here covers every caller, the rename route included.
        this.reload();
        // ⚠ A DRY RUN WROTE NOTHING, so it must not announce a commit or kick a refresh.
        if (!dryRun)
            this.onSystemWrite?.(out);
        return out;
    }
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
    fieldWrite(method, seg, query, body) {
        const { schema, ws } = engine();
        const store = this.store;
        const b = body ?? {};
        const name = seg[0] ?? "";
        const field = seg[1];
        const moduleId = query.get("module") ?? undefined;
        const dryRun = query.get("dry-run") === "true";
        const op = opOf(schema, "fields", method);
        if (!name)
            throw new ApiFailure("a field write names its collection: /fields/<collection>", 404);
        // ⚠ STRICT ON THE VERB SEGMENT. `seg[2]` is a verb only for POST (`rename`, `rename-value`); a PATCH or
        // DELETE carrying one used to be taken as an edit or a remove of the field itself — an answer to a
        // route the protocol does not name (@dreamteamer/protocol's drift probe found four).
        if (seg.length > 2 && !(method === "POST" && (seg[2] === "rename" || seg[2] === "rename-value") && seg.length === 3)) {
            throw new ApiFailure(`unhandled field op ${method} /fields/${seg.join("/")}`, 404);
        }
        // POST /fields/:c/:f/rename {to} — it rewrites the key in every record and in every descriptor
        // and view that names the field, which is exactly why it plans first.
        if (method === "POST" && field && seg[2] === "rename") {
            return op("renameField")(ws, store, name, field, b.to, { dryRun });
        }
        // POST /fields/:c/:f/rename-value {from, to} — one enum value, in every record and every
        // position (a view filter, a binding condition, a default) that names it. Plans first too.
        if (method === "POST" && field && seg[2] === "rename-value") {
            if (dryRun)
                return op("renameValuePlan")(ws, store, name, field, b.from, b.to);
            return op("renameValue")(ws, store, name, field, b.from, b.to);
        }
        // ⚠ TWO BODY SHAPES, ONE PER CALLER, and the engine owns both translations:
        //   { name, field: {…} }  a WHOLE v2 field (the designer's drawer, which edits every key) —
        //                         handed to the op as it is; on a PATCH it REPLACES the field.
        //   { name, type, … }     the FLAG vocabulary (the native Add Field…, the far side of a
        //                         relation) — `fieldFromFlags` builds the field; on a PATCH the flags
        //                         apply over the field as its SOURCE declares it, so a flag not named
        //                         leaves its key exactly as authored.
        const { name: fieldName, field: whole, ...flags } = b;
        // ⚠ THE ADD AND THE EDIT HAVE NO PLANNER, so a dry run answers the null plan and writes nothing —
        // they used to perform the write and commit it (rnd issue "a dry run of a field add, a field edit or
        // a non-move collection set WRITES"; the protocol's dry-run cases are its test).
        if (dryRun && ((method === "POST" && !field) || (method === "PATCH" && field)))
            return { plan: null, "dry-run": "unsupported" };
        if (method === "POST" && !field)
            return op("addField")(ws, store, name, {
                name: fieldName,
                field: whole ?? schema.fieldFromFlags(store, flags),
                moduleId,
            });
        if (method === "PATCH" && field)
            return op("updateField")(ws, store, name, field, whole ? { field: whole, moduleId } : { flags, moduleId });
        if (method === "DELETE" && field) {
            // ⚠ `removeField`'s plan is a separate READ-ONLY export, because the counts come from the
            // same two sweeps the real op runs. Routing a dry run to the op itself is safe on this
            // engine (it reads `dryRun`) but the export is the documented planner.
            if (dryRun)
                return op("removeFieldPlan")(ws, store, name, field, { moduleId });
            return op("removeField")(ws, store, name, field, { moduleId });
        }
        throw new ApiFailure(`unhandled field op ${method} /fields/${seg.join("/")}`, 404);
    }
    /** A field write is a source write too, so it refreshes and reports on the same terms. */
    afterFieldWrite(out, dryRun) {
        if (!dryRun)
            this.onSystemWrite?.(out);
        return out;
    }
    // ---- git -----------------------------------------------------------------------------------------
    // Both delegate. These used to be a hand-copy of server.js's `git log`/`git diff`, which is how
    // they came to be subtly wrong here AND there: a system-stored record (collection, ui-view,
    // skill…) resolves to a file in the gitignored runtime, so history was empty — or, in a
    // workspace old enough to have once tracked `.dreamteamer/`, confidently stale. The engine
    // resolves the record back to its manifest sources; this is a transport, so it just asks.
    history(name, id) {
        return engine().history(this.store, name, id);
    }
    historyDiff(name, id, hash) {
        return engine().historyDiff(this.store, name, id, hash);
    }
}
// ONE `git log` per REPO per collection listing rather than one spawn per record — newest-first, so
// the first sighting of a path is its most recent touching commit (from server.js). Keys are
// WORKSPACE-relative paths, whichever repo answered.
//
// ⚠ A collection's records can sit in more than one repo (engine 0.35.0): a module-owned collection
// lives in the module's clone and a record layer in another workspace's, both under `git_modules/`,
// which the workspace's own repo ignores — so asking only the workspace answered no date at all for
// them. `repoOf` names the repo holding each folder (workspace-relative, `.` the workspace itself);
// the folders are grouped by it and git runs in each, `--relative` so a path comes back relative to
// that repo and is re-rooted here.
export function gitHistoryMap(root, dirs, repoOf = () => ".") {
    const map = new Map();
    const byRepo = new Map();
    for (const dir of dirs) {
        if (path.relative(root, dir).startsWith(".."))
            continue;
        const repo = repoOf(dir);
        byRepo.set(repo, [...(byRepo.get(repo) ?? []), dir]);
    }
    for (const [repo, repoDirs] of byRepo) {
        const cwd = path.join(root, repo);
        const rels = repoDirs.map((dir) => path.relative(cwd, dir)).filter((rel) => rel && !rel.startsWith(".."));
        if (!rels.length)
            continue;
        let out;
        try {
            out = execFileSync("git", ["log", "--format=%x01%aI%x02%an", "--name-only", "--relative", "--", ...rels], { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
        }
        catch {
            continue;
        }
        parseGitHistory(out, (line) => (repo === "." ? line : path.relative(root, path.join(cwd, line))), map);
    }
    return map;
}
/**
 * `git log --format=%x01%aI%x02%an --name-only` output → each file's history. Newest first, so a
 * file's FIRST sighting is its last change (date and author) and its LAST sighting the commit that
 * added it — who made a record, beside who last touched it (operator 2026-10-29: author and the like
 * as list fields). A rename is not followed: the file "starts" at the rename, the blind spot
 * `last-modified` always had.
 */
export function parseGitHistory(out, keyOf, into = new Map()) {
    let date = null;
    let author = null;
    for (const line of out.split("\n")) {
        if (line.startsWith("\x01")) {
            const [d, a] = line.slice(1).split("\x02");
            date = d || null;
            author = a || null;
            continue;
        }
        if (!line)
            continue;
        const key = keyOf(line);
        const seen = into.get(key);
        if (seen)
            seen.createdBy = author;
        else
            into.set(key, { modified: date, by: author, createdBy: author });
    }
    return into;
}
function gitLastCommit(root, file) {
    const rel = path.relative(root, file);
    if (rel.startsWith(".."))
        return null;
    try {
        // asked FROM THE FILE'S OWN FOLDER, so git finds whichever repo holds it — a module-owned or a
        // record-layer file is in another clone, which the workspace's repo has no history for
        const out = execFileSync("git", ["log", "-1", "--format=%aI%x00%an%x00%s", "--", path.basename(file)], { cwd: path.dirname(file), stdio: ["ignore", "pipe", "ignore"] })
            .toString()
            .trim();
        if (!out)
            return null;
        const [date, author, message] = out.split("\0");
        return { date: date, author: author, message: message };
    }
    catch {
        return null;
    }
}
/** The wire keys the source rides on — the extension's own, beside `last-modified`. */
export const SOURCE_KEY = "$source";
export const SOURCE_KIND_KEY = "$source-kind";
/** The roots holding stubs (`stub: true`, engine 0.41.0) that the answering record shadows — names. */
export const STUBS_KEY = "$stubs";
/** Who last changed a record, and who added it — `parseGitHistory`, on every list row. */
export const MODIFIED_BY_KEY = "$last-modified-by";
export const CREATED_BY_KEY = "$created-by";
/** A row's history keys: `last-modified` as before, and the two authors beside it. */
function historyKeys(h) {
    return { ...lastModifiedKeys(h?.modified ?? null), [MODIFIED_BY_KEY]: h?.by ?? null, [CREATED_BY_KEY]: h?.createdBy ?? null };
}
/**
 * The last commit date under BOTH names. `last_modified` is the display contract's field (descriptor
 * v2 injects it as a virtual field, so the record page draws a "Last modified" row and a list may name
 * it as a column) — sent only as the v1 `last-modified`, that row read empty on every record. The v1
 * key stays: the header's commit line, the default sort and saved views still say it.
 */
function lastModifiedKeys(date) {
    return { "last-modified": date, last_modified: date };
}
/** On a runtime kind's row: the module it was compiled from (`src/module-of.ts`). */
export const MODULE_KEY = "$module";
export const DUPLICATES_KEY = "$duplicates";
/** `$source` and `$source-kind` for a row, from the root its file was read from; nothing for a file
 *  no root claims (which `readAll` never yields — stated so the shape is total). */
function sourceKeys(source) {
    return source ? { [SOURCE_KEY]: source.name, [SOURCE_KIND_KEY]: source.kind } : {};
}
/** Set `a.b.c` in a plain object, creating the blocks on the way — `dt set`'s dotted-key grammar. */
function setDotted(obj, dotted, value) {
    const keys = dotted.split(".");
    let at = obj;
    for (const k of keys.slice(0, -1)) {
        if (!at[k] || typeof at[k] !== "object" || Array.isArray(at[k]))
            at[k] = {};
        at = at[k];
    }
    at[keys[keys.length - 1]] = value;
}
/**
 * The `(kind, verb)` pairs the engine's own ops accept a `--dry-run` for.
 *
 * ⚠ DECLARATIVE, AND DELIBERATELY SHORT. It is a fact about the engine's verb table, mirrored here
 * for one reason: a dry run routed to an op that does not read the flag PERFORMS THE WRITE and
 * reports it as a plan. Anything absent answers a null plan and the surface asks without a count.
 * `remove-field`'s plan is not here because it is a separate read-only export, not a flag.
 *
 * ⚠ TWO PLANS EXIST IN THE ENGINE AND CANNOT BE REACHED FROM HERE, and the gap is the engine's, not
 * a line missing from this set. `rename collections/<old> <new>` and `rm collections/<name>` both
 * print a plan on the CLI, but they compute it inside the CLI's own printer — `renameCollection` and
 * `removeCollection` take no `dryRun` and `schema-ops` exports no `renameCollectionPlan` /
 * `removeCollectionPlan` beside the `renameFieldPlan` / `removeFieldPlan` it does export. Adding
 * either pair to this set would route a dry run to an op that ignores the flag, i.e. PERFORM the
 * rename and report it as a plan — the exact failure this whole mechanism exists to prevent, and one
 * the engine's own CLI shipped four times over. Until the engine exports those two plans, the
 * surface says so out loud (`schema-plan.ts`'s `NO_PLAN`) rather than showing a count nobody
 * computed or, worse, nothing at all.
 */
const DRY_RUNNABLE = new Set(["modules:rm", "collections:set", "ui-views:set"]);
/**
 * One named schema-op, or a message that names the export rather than `fn is not a function`.
 *
 * The floor (`dreamteamer.minEngine`, checked before a single engine module is imported) is what
 * guarantees these exist, so this is not a fallback — it is the message for the one state that can
 * reach here anyway: an engine running below the floor because `dreamteamer.engine.allowBelowFloor`
 * is holding the door open, which the setting's own description warns can 404 a gesture.
 */
/** Ops this extension routes to that are newer than `dreamteamer.minEngine` (`engine.ts` reads them by key). */
const OPTIONAL_OPS = new Set(["moveUiView"]);
function opOf(schema, kind, verb) {
    return (name) => {
        const fn = schema[name];
        if (typeof fn !== "function") {
            // an op newer than the floor is absent from an engine the floor still accepts — say THAT,
            // rather than blaming a floor the workspace meets
            throw new ApiFailure(OPTIONAL_OPS.has(name)
                ? `this workspace's engine has no \`${name}\`, which is what \`${verb} ${kind}\` is routed to — it is newer than the engine this workspace pins. Upgrade dreamteamer in the workspace once a release carries it.`
                : `this workspace's engine has no \`${name}\`, which is what \`${verb} ${kind}\` is routed to. `
                    + `The extension needs a newer dreamteamer (see \`dreamteamer.minEngine\`) and is running `
                    + `below that floor by request.`, 404);
        }
        return fn;
    };
}
