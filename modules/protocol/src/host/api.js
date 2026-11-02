// Ported from the dreamteamer VS Code extension's host side (src/api.ts); PROTOCOL.md is the contract it answers.
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
import { byId, notesFor } from "./next-notes.js";
import { refsIn } from "./note-refs.js";
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
    onSystemWrite;
    constructor(root) {
        this.root = root;
        this.reload();
        try {
            const name = execFileSync("git", ["config", "user.name"], { cwd: root }).toString().trim();
            this.operatorId = engine().slugOrHash(name);
        }
        catch {
        }
    }
    activityReads = new Map();
    activityPages = new Map();
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
        const npm = (m) => m.location === "node_modules" || (m.path ?? "").split("/").includes("node_modules");
        let scopes = picked.flatMap((m) => {
            const own = moduleScope(this.root, m, ws, recordDirsOf);
            if (own)
                return [own];
            return moduleId && npm(m) ? recordScopes(this.root, recordDirsOf(m.id)) : [];
        });
        if (!moduleId && !scopes.some((s) => s.repo === "." && !s.paths.length))
            scopes.push({ repo: ".", paths: [] });
        const workspaceName = this.sourcesCtx().workspace;
        if (source)
            scopes = scopes.filter((s) => repoName(s.repo, workspaceName) === source);
        return scopes;
    }
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
    reload() {
        this.store = new (engine().Store)(engine().ws);
        this.manifestMtime = this.mtime();
        this.sourcesCache = null;
        this.runtimeModulesCache = null;
    }
    runtimeModulesCache = null;
    runtimeModules() {
        if (!this.runtimeModulesCache) {
            const modules = loadModules(this.root);
            this.runtimeModulesCache = { files: loadRuntimeModules(this.root, modules), ids: new Set(modules.map((m) => m.id)), workspace: workspaceModule(this.root) };
        }
        return this.runtimeModulesCache;
    }
    sourcesCache = null;
    sourcesCtx() {
        return (this.sourcesCache ??= sourcesContext(this.root, this.store.descriptors.values()));
    }
    runtimeModuleOf(file) {
        return moduleOfRuntimeFile(path.relative(path.join(this.root, ".dreamteamer"), file).split(path.sep).join("/"), this.runtimeModules().files);
    }
    sourcesOf(d) {
        if (!engine().descriptor.isRuntime(d))
            return collectionSources(this.root, d, this.sourcesCtx());
        return runtimeSources([...this.store.readAll(d.name)].map(({ file }) => this.runtimeModuleOf(file)), this.sourcesCtx());
    }
    contested(d) {
        const isStub = (file) => {
            try {
                return engine().parseRecordText(fs.readFileSync(file, "utf8"), d)?.stub === true;
            }
            catch {
                return false;
            }
        };
        return contestedIds(this.root, d, isStub);
    }
    stubRootNames(stubs, sources) {
        const out = new Map();
        for (const [id, roots] of stubs) {
            const names = roots.map((r) => sources.find((x) => x.path === path.relative(this.root, r.dir).split(path.sep).join("/"))?.name ?? r.repo);
            out.set(id, [...new Set(names)]);
        }
        return out;
    }
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
    fresh() {
        if (this.mtime() !== this.manifestMtime)
            this.reload();
        return this.store;
    }
    descriptors() {
        return this.fresh().descriptors;
    }
    async handle(method, rawPath, body) {
        try {
            return { status: 200, body: await this.route(method, rawPath, body) };
        }
        catch (err) {
            const msg = err?.message ?? String(err);
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
        if (method !== "GET") {
            const dry = query.getAll("dry-run");
            if (dry.length && !(dry.length === 1 && (dry[0] === "true" || dry[0] === "false"))) {
                throw new ApiFailure(`${method} ${pathname} does not understand ?dry-run=${dry.join("&dry-run=")} — use ?dry-run=true or ?dry-run=false; nothing was written`, 400);
            }
        }
        const store = this.fresh();
        const eng = engine();
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
                workspace_module: eng.ws.pkg.dreamteamer?.workspace_module ?? null,
                ui: manifest?.ui ?? [],
                user: this.operatorId,
                stale,
                collections: [...store.descriptors.keys()],
            };
        }
        if (seg[0] === "schema" && seg.length === 1 && method === "GET") {
            const order = (d) => eng.descriptor.displayOf(d).nav?.order ?? 999;
            return [...store.descriptors.values()].sort((a, b) => order(a) - order(b));
        }
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
        if (seg[0] === "sources" && seg.length === 1 && method === "GET") {
            return sourcesStack(this.root, [...store.descriptors.values()], this.sourcesCtx());
        }
        if (seg[0] === "activity" && seg.length === 1 && method === "GET") {
            const offset = Math.max(0, Math.floor(Number(query.get("offset") ?? 0)) || 0);
            const settled = query.has("settled") ? Math.max(0, Math.floor(Number(query.get("settled"))) || 0) : undefined;
            return this.activity(query.get("module") ?? undefined, Math.min(Number(query.get("limit") ?? ACTIVITY_PAGE) || ACTIVITY_PAGE, 500), offset, settled, query.get("source") || undefined);
        }
        if (seg[0] === "fields" && method !== "GET") {
            await this.currentHandle();
            const out = this.fieldWrite(method, seg.slice(1), query, body);
            this.reload();
            return this.afterFieldWrite(out, query.get("dry-run") === "true");
        }
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
        if (seg[0] === "collections") {
            const name = seg[1] ?? "";
            this.hintUnencoded(seg, name);
            const tail = seg[2] ?? "";
            const id = seg.slice(3).join("/");
            const descriptor = store.descriptor(name);
            const writtenAsSource = descriptor ? eng.descriptor.isRuntime(descriptor) : false;
            if (writtenAsSource && method !== "GET")
                await this.currentHandle();
            if (!writtenAsSource && method !== "GET" && query.get("dry-run") === "true") {
                return { plan: null, "dry-run": "unsupported" };
            }
            if (tail === "values" && method === "GET") {
                const field = seg.slice(3).join("/");
                if (field === SOURCE_KEY) {
                    const values = this.sourcesOf(descriptor).filter((x) => x.count > 0).map((x) => ({ value: x.name, count: x.count }));
                    return { collection: name, field, values, total: values.length, truncated: false };
                }
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
                        return this.listRecords(name, query, { notes: query.get("notes") === "1" });
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
            if (tail === "files" && method === "POST") {
                const { id: fileId, from, force } = body ?? {};
                if (!fileId || !from)
                    throw new Error("a file record needs both an id and a `from` path");
                const written = store.addFile(name, String(fileId), String(from), { force: force === true });
                return { id: written.id, path: path.relative(this.root, written.file) };
            }
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
                return store.revert(name, id, revisionParam(body?.hash));
        }
        if (seg[0] === "commands" && seg.length === 2 && method === "GET") {
            const ids = (query.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            return eng.commandsFor(store, seg[1], ids);
        }
        if (seg[0] === "notes" && seg.length === 2 && method === "GET") {
            const ids = (query.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            return { notes: notesFor(store, seg[1], ids) };
        }
        if (seg[0] === "sessions" && seg[1] === "running" && seg.length === 2 && method === "GET") {
            return this.runningSessions();
        }
        if (seg[0] === "commit" && seg.length === 1 && method === "POST") {
            if (!(body?.dryRun === true || query.get("dry-run") === "true"))
                forgetAhead();
            return eng.commitPending(store, {
                only: Array.isArray(body?.only) ? body.only : [],
                message: typeof body?.message === "string" ? body.message : undefined,
                dryRun: body?.dryRun === true || query.get("dry-run") === "true",
            });
        }
        if (seg[0] === "history" && method === "GET")
            return this.history(seg[1] ?? "", seg.slice(2).join("/"));
        if (seg[0] === "history-diff" && method === "GET")
            return this.historyDiff(seg[1] ?? "", seg.slice(2).join("/"), revisionParam(query.getAll("hash").length > 1 ? query.getAll("hash") : (query.get("hash") ?? "HEAD")));
        if (seg[0] === "reload" && method === "POST") {
            this.reload();
            return { ok: true };
        }
        throw new ApiFailure(`unhandled request ${method} ${rawPath}`, 404);
    }
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
    runningSessions() {
        const eng = engine();
        const store = new eng.Store(eng.ws);
        if (!store.descriptors.has("sessions"))
            return { state: "absent", sessions: [] };
        let all;
        try {
            all = [...store.readAll("sessions")];
        }
        catch (e) {
            return { state: "unreadable", reason: String(e?.message ?? e).split("\n")[0], sessions: [] };
        }
        const shown = (v) => (v instanceof Date ? v.toISOString() : v == null ? undefined : String(v));
        const at = (f) => Date.parse(shown(f.heartbeat ?? f.started) ?? "") || 0;
        const running = all.filter((s) => s.fields.status === "running").sort((a, b) => at(b.fields) - at(a.fields));
        const collections = [...store.descriptors.keys()];
        const split = (ref) => refsIn(ref, collections).find((r) => r.start === 0 && r.end === ref.length);
        const wanted = new Map();
        for (const s of running)
            for (const ref of [].concat(s.fields.records ?? [])) {
                const r = split(String(ref));
                if (r)
                    (wanted.get(r.collection) ?? wanted.set(r.collection, new Set()).get(r.collection)).add(r.id);
            }
        const notes = new Map();
        for (const [c, ids] of wanted)
            notes.set(c, byId(notesFor(store, c, [...ids])));
        let fsDescs;
        const titleOf = (c, id) => {
            const d = (fsDescs ??= loadDescriptors(this.root)).find((x) => x.name === c);
            if (!d)
                return undefined;
            const t = recordTitle(this.root, d, id);
            return t && t !== id ? t : undefined;
        };
        return {
            state: "ok",
            sessions: running.map(({ id, fields }) => ({
                id,
                name: String(fields.name ?? id),
                ...(fields.worker ? { worker: String(fields.worker) } : {}),
                ...(fields.harness ? { harness: String(fields.harness) } : {}),
                ...(fields.host ? { host: String(fields.host) } : {}),
                started: shown(fields.started),
                ...(fields.heartbeat ? { heartbeat: shown(fields.heartbeat) } : {}),
                records: [].concat(fields.records ?? []).map((raw) => {
                    const ref = String(raw);
                    const r = split(ref);
                    if (!r || !this.holds(store, r.collection, r.id))
                        return { ref, notes: [] };
                    const lines = notes.get(r.collection)?.get(r.id) ?? [];
                    const anySession = lines.some((n) => n.refs.some((x) => x.collection === "sessions"));
                    const mine = anySession ? lines.filter((n) => n.refs.some((x) => x.ref === `sessions/${id}`)) : lines;
                    const title = titleOf(r.collection, r.id);
                    return { ref, collection: r.collection, id: r.id, ...(title ? { title } : {}), notes: mine };
                }),
            })),
        };
    }
    holds(store, collection, id) {
        try {
            store.read(collection, id);
            return true;
        }
        catch {
            return false;
        }
    }
    listRecords(name, query, opts = {}) {
        const store = this.store;
        const eng = engine();
        const d = store.descriptor(name);
        const bf = eng.bodyField(d);
        const descriptors = [...store.descriptors.values()];
        const history = gitHistoryMap(this.root, store.recordDirs(d), (dir) => repoOfPath(this.root, descriptors, dir));
        const sources = this.sourcesOf(d);
        const contested = this.contested(d);
        const dupes = contested.duplicates;
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
        const stubsById = this.stubRootNames(contested.stubs, sources);
        let rows = [];
        for (const { id, file, fields } of store.readAll(name)) {
            const created = fields.created === undefined ? store.createdOf(name, id, fields, file) : undefined;
            const dupe = dupes.get(id);
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
        let facetRows;
        if (filter) {
            const f = JSON.parse(filter);
            const resolve = eng.recordResolver(store);
            const unsourced = withoutSourceClauses(f);
            if (unsourced !== f)
                facetRows = unsourced === undefined ? rows : rows.filter((r) => eng.matchesFilter(r, unsourced, resolve));
            rows = rows.filter((r) => eng.matchesFilter(r, f, resolve));
        }
        const KNOWN = new Set(["limit", "offset", "sort", "q", "filter", "with-body", "notes"]);
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
        eng.sortRows(rows, query.get("sort"), eng.descriptor.jsonSchemaOf(d));
        const total = rows.length;
        const facet = new Map(sources.map((x) => [x.name, 0]));
        for (const r of facetRows ? narrow(facetRows) : rows)
            facet.set(r[SOURCE_KEY], (facet.get(r[SOURCE_KEY]) ?? 0) + 1);
        const offset = Number(query.get("offset") ?? 0);
        const limit = Number(query.get("limit") ?? 200);
        rows = rows.slice(offset, offset + limit);
        if (opts.notes && rows.length) {
            const notes = byId(notesFor(store, name, rows.map((r) => String(r.id))));
            if (notes.size)
                for (const r of rows) {
                    const n = notes.get(String(r.id));
                    if (n)
                        r.$notes = n;
                }
        }
        if (bf && query.get("with-body") !== "true")
            for (const r of rows)
                delete r[bf];
        return { records: rows, total, sources: sources.map((x) => ({ ...x, count: facet.get(x.name) ?? 0 })) };
    }
    readRecord(name, id) {
        const { fields, file } = this.store.read(name, id);
        const commit = gitLastCommit(this.root, file);
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
                ...(engine().descriptor.isRuntime(d) ? {} : repoStateKeys(this.root, locateRecord(this.store, name, id))),
                ...(engine().descriptor.isRuntime(d) && this.runtimeModuleOf(file) ? { [MODULE_KEY]: this.runtimeModuleOf(file) } : {}),
                ...(dupe ? { [DUPLICATES_KEY]: dupe.map((r) => sources.find((x) => x.path === path.relative(this.root, r.dir).split(path.sep).join("/"))?.name ?? r.repo) } : {}),
                ...(stubs?.length ? { [STUBS_KEY]: stubs } : {}),
            },
            path: path.relative(this.root, file),
        };
    }
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
        this.reload();
        return { id, path: path.relative(this.root, file), source: chosen.name };
    }
    patchRecord(name, id, body) {
        const { id: _id, path: _path, "last-modified": _lm, last_modified: _lm2, ...rest } = body ?? {};
        const changes = Object.fromEntries(Object.entries(rest).filter(([k]) => !k.startsWith("$")));
        this.store.set(name, id, changes);
        return { id };
    }
    systemWrite(verb, kind, id, query, body) {
        const { schema, ws } = engine();
        const store = this.store;
        const b = body ?? {};
        const moduleId = query.get("module") ?? undefined;
        const force = query.get("force") === "true";
        const dryRun = query.get("dry-run") === "true";
        const op = opOf(schema, kind, verb);
        if (dryRun && !DRY_RUNNABLE.has(`${kind}:${verb}`)) {
            return { plan: null, "dry-run": "unsupported" };
        }
        const out = (() => {
            switch (`${kind}:${verb}`) {
                case "modules:add":
                    return op("createModule")(ws, store, { name: b.name, description: b.description });
                case "modules:set":
                    return op("setModule")(ws, store, id, b);
                case "modules:rename":
                    return op("renameModule")(ws, store, b.old, b.new);
                case "modules:rm":
                    return op("removeModule")(ws, store, id, { force, dryRun });
                case "collections:add":
                    return op("createCollection")(ws, store, {
                        name: b.name,
                        mixins: b.mixins,
                        idFrom: b.idFrom,
                        namespace: b.namespace,
                        description: b.description,
                        suffix: b.suffix,
                        moduleId,
                    });
                case "collections:set":
                    if (dryRun && b.module === undefined)
                        return { plan: null, "dry-run": "unsupported" };
                    return b.module !== undefined
                        ? op("moveCollection")(ws, store, id, String(b.module), { dryRun })
                        : op("setCollectionScalars")(ws, store, id, b, { moduleId });
                case "collections:rename":
                    return op("renameCollection")(ws, store, b.old, b.new);
                case "collections:rm":
                    return op("removeCollection")(ws, store, id, { force });
                case "ui-views:add": {
                    const { id: viewId, ...view } = b;
                    return op("saveUiView")(ws, store, { id: viewId ?? engine().slug(String(view.route ?? "")), view, moduleId });
                }
                case "ui-views:set": {
                    if (b.module !== undefined) {
                        const { module: to, ...rest } = b;
                        if (Object.keys(rest).length)
                            throw new ApiFailure(`module moves the view to another module; the other keys rewrite it — send them as two writes (${Object.keys(rest).join(", ")})`, 400);
                        return op("moveUiView")(ws, store, id, String(to), { dryRun });
                    }
                    if (dryRun)
                        return { plan: null, "dry-run": "unsupported" };
                    const current = JSON.parse(JSON.stringify(store.read("ui-views", id).fields));
                    delete current.id;
                    delete current.compiled;
                    for (const [k, v] of Object.entries(b))
                        setDotted(current, k, v);
                    return op("saveUiView")(ws, store, { id, view: current });
                }
                case "ui-views:rm":
                    return op("removeUiView")(ws, store, id);
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
        this.reload();
        if (!dryRun)
            this.onSystemWrite?.(out);
        return out;
    }
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
        if (seg.length > 2 && !(method === "POST" && (seg[2] === "rename" || seg[2] === "rename-value") && seg.length === 3)) {
            throw new ApiFailure(`unhandled field op ${method} /fields/${seg.join("/")}`, 404);
        }
        if (method === "POST" && field && seg[2] === "rename") {
            return op("renameField")(ws, store, name, field, b.to, { dryRun });
        }
        if (method === "POST" && field && seg[2] === "rename-value") {
            if (dryRun)
                return op("renameValuePlan")(ws, store, name, field, b.from, b.to);
            return op("renameValue")(ws, store, name, field, b.from, b.to);
        }
        const { name: fieldName, field: whole, ...flags } = b;
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
            if (dryRun)
                return op("removeFieldPlan")(ws, store, name, field, { moduleId });
            return op("removeField")(ws, store, name, field, { moduleId });
        }
        throw new ApiFailure(`unhandled field op ${method} /fields/${seg.join("/")}`, 404);
    }
    afterFieldWrite(out, dryRun) {
        if (!dryRun)
            this.onSystemWrite?.(out);
        return out;
    }
    history(name, id) {
        return engine().history(this.store, name, id);
    }
    historyDiff(name, id, hash) {
        return engine().historyDiff(this.store, name, id, hash);
    }
}
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
export const SOURCE_KEY = "$source";
export const SOURCE_KIND_KEY = "$source-kind";
export const STUBS_KEY = "$stubs";
export const MODIFIED_BY_KEY = "$last-modified-by";
export const CREATED_BY_KEY = "$created-by";
function historyKeys(h) {
    return { ...lastModifiedKeys(h?.modified ?? null), [MODIFIED_BY_KEY]: h?.by ?? null, [CREATED_BY_KEY]: h?.createdBy ?? null };
}
function lastModifiedKeys(date) {
    return { "last-modified": date, last_modified: date };
}
export const MODULE_KEY = "$module";
export const DUPLICATES_KEY = "$duplicates";
function sourceKeys(source) {
    return source ? { [SOURCE_KEY]: source.name, [SOURCE_KIND_KEY]: source.kind } : {};
}
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
const DRY_RUNNABLE = new Set(["modules:rm", "collections:set", "ui-views:set"]);
const OPTIONAL_OPS = new Set(["moveUiView"]);
function opOf(schema, kind, verb) {
    return (name) => {
        const fn = schema[name];
        if (typeof fn !== "function") {
            throw new ApiFailure(OPTIONAL_OPS.has(name)
                ? `this workspace's engine has no \`${name}\`, which is what \`${verb} ${kind}\` is routed to — it is newer than the engine this workspace pins. Upgrade dreamteamer in the workspace once a release carries it.`
                : `this workspace's engine has no \`${name}\`, which is what \`${verb} ${kind}\` is routed to. `
                    + `The extension needs a newer dreamteamer (see \`dreamteamer.minEngine\`) and is running `
                    + `below that floor by request.`, 404);
        }
        return fn;
    };
}
export function revisionParam(value) {
    const v = typeof value === "string" ? value : "";
    if (v === "HEAD" || /^[0-9a-f]{4,40}$/.test(v))
        return v;
    throw new ApiFailure(`${JSON.stringify(String(value ?? "")).slice(0, 60)} is not a commit id — a revision is HEAD or a commit id of 4 to 40 hex characters; nothing was run`, 400);
}
