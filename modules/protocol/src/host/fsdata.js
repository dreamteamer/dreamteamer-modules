// pure-FS read layer over a dreamteamer workspace — mirrors the engine's Store
// read rules (store.js) without needing a server: descriptors from the compiled
// .dreamteamer runtime, records from data/ / state/ / .dreamteamer/system.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as yaml from "js-yaml";
export const EXT = { md: ".md", yaml: ".yaml", json: ".json" };
/** The engine's descriptor accessors — the shorthand every reader below goes through. */
const acc = () => engine().descriptor;
/** The display a view DRAWS — compile's merge over its collection's, else what it authored. */
export function viewDisplay(v) {
    return v.compiled?.display ?? v.display ?? {};
}
/** What a view is called wherever it is listed: its nav title, else its own title, else its id. */
export function viewLabel(v) {
    return v.display?.nav?.title ?? v.title ?? v.name ?? v.id;
}
/**
 * A collection's NAMED views as the nav lists them under it: the collection-scope views of that
 * collection that carry a `display.nav` — the engine's rule, "a view with no `nav` has no nav
 * entry". There is no default to exclude: a collection's default view is its own `display`, and
 * the collection row already opens it.
 */
export function navViewsOf(views, collection) {
    return views.filter((v) => v.scope === "collection" && !!v.display?.nav && viewCollection(v) === collection);
}
/** How a view row reads in the tree: its label, its icon, and its layout when that is not a table. */
export function viewRow(v) {
    const layout = viewDisplay(v).list?.layout;
    return {
        label: viewLabel(v),
        icon: v.display?.nav?.icon ?? "bookmark",
        description: layout && layout !== "table" ? layout : undefined,
        tooltip: `\`${v.route}\`  \n_saved view of ${viewCollection(v)}_`,
    };
}
/** The bare collection a view is of (`collections/` dropped), or `""` for a page. */
export function viewCollection(v) {
    return (v.collection ?? "").replace(/^collections\//, "");
}
export function findWorkspaceRoot(folders) {
    for (const f of folders) {
        if (fs.existsSync(path.join(f.fsPath, ".dreamteamer", "manifest.yaml")))
            return f.fsPath;
        const pkg = path.join(f.fsPath, "package.json");
        if (fs.existsSync(pkg)) {
            try {
                if (JSON.parse(fs.readFileSync(pkg, "utf8")).dreamteamer)
                    return f.fsPath;
            }
            catch { }
        }
    }
    return undefined;
}
/**
 * Are this collection's records the COMPILED runtime's build output (`compiled.runtime`)? Runtime-stored
 * records (collections, skills, agents, ui-views…) are generated, gitignored and not writable through
 * the store — they are edited as sources and recompiled. Getting this wrong in the false direction
 * offers a write gesture on a compiled artifact.
 *
 * ⚠ A STORAGE question — it decides HOW A WRITE IS PERFORMED. Where a collection is DRAWN is
 * `isInternal`, and the two are orthogonal (design §3.3): `repos` is internal and not runtime.
 */
export function isRuntime(d) {
    return acc().isRuntime(d);
}
/**
 * Is this collection DRAWN as the workspace's plumbing — folded out of the record tree, routed under
 * `/settings`, listed on the Schema tab? Authored `internal: true` (design §3.3), which replaced the
 * reserved `group: system` partition.
 *
 * ⚠ THIS IS NOT `isRuntime`, AND THE DIFFERENCE IS THE POINT. That one answers whether the records are
 * build output, which is what decides if a surface may offer to write them. This one answers where the
 * collection is drawn. `repos` is internal while its records are ordinary files the operator edits, so
 * asking this one in the writable-collection picker would hide repos AND make it uneditable.
 */
export function isInternal(d) {
    return acc().isInternal(d);
}
/**
 * A folder of the compiled runtime (`collections`, `ui-views`, …). One place knows this layout, so
 * the reveal gestures point at the same files the loaders below read.
 *
 * Probed rather than constructed: the engine flattened the runtime from `.dreamteamer/system/<kind>`
 * to `.dreamteamer/<kind>`, and this extension can be paired with an engine on either side of that
 * (the workspace pins the engine; the two repos ship independently). Probing is layout-agnostic in
 * both directions and costs one `existsSync` — deriving it from the manifest would need a yaml parse
 * and a second thing to keep in step.
 */
export function systemDir(root, kind) {
    const flat = path.join(root, ".dreamteamer", kind);
    if (fs.existsSync(flat))
        return flat;
    const nested = path.join(root, ".dreamteamer", "system", kind);
    return fs.existsSync(nested) ? nested : flat; // neither present: name the current layout
}
/** module id → the modules it declares a hard dependency on, for the nav's one-hop fold (`nav.ts`).
 *  Empty on a runtime whose module records carry no `dependencies`, which turns the rule off rather
 *  than guessing at a graph. */
export function moduleDependencies(root) {
    return new Map(loadModules(root).filter((m) => m.dependencies?.length).map((m) => [m.id, m.dependencies]));
}
/** module id → the namespaces it declares, for the nav's one-module-one-folder fold (`nav.ts`): a
 *  module that declares a namespace files its default-namespace collections in that namespace's folder
 *  rather than a module folder beside it. Empty when no module record carries `namespaces`. */
export function moduleNamespaces(root) {
    return new Map(loadModules(root).filter((m) => m.namespaces?.length).map((m) => [m.id, m.namespaces]));
}
/** The modules this workspace compiled — their titles label the nav's folders, their
 *  `dependencies` drive its one-hop fold. Empty before the first compile. */
export function loadModules(root) {
    const dir = systemDir(root, "modules");
    if (!fs.existsSync(dir))
        return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".module.yaml"))
            continue;
        try {
            const doc = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"));
            out.push({ ...doc, id: f.replace(/\.module\.yaml$/, "") });
        }
        catch { }
    }
    return out;
}
/** The module the workspace's OWN sources live in — `dreamteamer.workspace_module` in the root
 *  `package.json` (design §4.4), the ONLY place it is declared (the compiled manifest does not carry
 *  it). Undefined when nothing declares it or the file cannot be read, and the nav's module fold is
 *  OFF in that case (`groupTopLevel`): without knowing which module is the operator's own catch-all,
 *  folding by module would put their whole vault under one folder named after itself. */
export function workspaceModule(root) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        const v = pkg?.dreamteamer?.workspace_module;
        return typeof v === "string" && v ? v : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * The workspace's own NAME — the root `package.json` `name`, the word a record read from the write root
 * is sourced to (the extension's `$source`, 0.24.0). The folder's basename when the package names none,
 * so a source is never the empty string.
 */
export function workspaceName(root) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        const v = pkg?.name;
        return typeof v === "string" && v ? v : path.basename(root);
    }
    catch {
        return path.basename(root);
    }
}
/**
 * The compiled descriptors, in nav order (`display.nav.order`, unordered last). ONE IMPLEMENTATION: the
 * engine's own loader is the authority on what is in `.dreamteamer/collections` — including that the
 * walk is RECURSIVE (a namespaced collection lands at `collections/<ns>/<name>.collection.yaml`).
 *
 * It used to keep a second, YAML-reading copy for a "pre-activation window" in which the tree was built
 * before the engine loaded. That window closed when the boot moved behind `initEngine` (`bootWorkspace`
 * runs only once the engine has loaded), and a second reader of the compiled shape is exactly the copy
 * that drifts when the shape moves — so there is one now, and asking before the engine has loaded
 * throws `engine()`'s own "not loaded yet".
 */
export function loadDescriptors(root) {
    const order = (d) => acc().displayOf(d).nav?.order ?? 999;
    // the engine answers `null` for a workspace with no compiled runtime yet — no collections, not an error
    return [...(engine().loadDescriptors(root)?.values() ?? [])].sort((a, b) => order(a) - order(b));
}
/**
 * EVERY root a collection's records are read from, in the engine's order: the WRITE root first, then
 * each record layer (engine 0.35.0, `storageOf(d).roots` — another workspace cloned under
 * `git_modules/` whose manifest entry lists this collection, or — engine 0.41.0 — whose clone names its
 * `workspace_module` and is read whole). The same list `Store#rootsOf` walks.
 *
 * `roots` is always answered: `minEngine` is 0.36.0 (0.24.0), and the fallback this used to keep for
 * an engine before 0.35.0 went with the floor — one reader of one answer. A module-owned collection
 * (`storage.owner: module`) needs nothing extra: its `path` already points into the module's folder,
 * and its `repo` says which clone holds it.
 *
 * Under `.dreamteamer/` for a runtime kind, the workspace otherwise (compile refuses a layer on a
 * runtime kind, so a runtime collection always has exactly one root).
 */
export function collectionRoots(root, d) {
    const s = acc().storageOf(d);
    const base = isRuntime(d) ? path.join(root, ".dreamteamer") : root;
    return s.roots.map((r) => ({
        // RESOLVED, never joined: an env-pointed root (`${env:NAME}/…`, engine 0.39.0) compiles to an
        // ABSOLUTE folder outside the workspace, and `join` filed it under the workspace instead
        dir: path.resolve(base, r.path),
        repo: r.repo ?? s.repo ?? ".",
        ...(r.layer ? { layer: r.layer } : {}),
    }));
}
/** A collection's own records root — the WRITE root, where a new record lands. Every root a record can
 *  be READ from is `collectionRoots`. */
export function collectionDir(root, d) {
    return collectionRoots(root, d)[0].dir;
}
/**
 * The git repo holding `abs` (a file or a folder), workspace-relative: the repo of the LONGEST
 * collection root that contains it, across every root of every collection — the same longest-root
 * rule `fileToRecord` and the engine's `pathToRecord` use. `.` when no root claims it.
 */
export function repoOfPath(root, descriptors, abs) {
    const target = path.resolve(abs);
    let best;
    for (const d of descriptors) {
        for (const r of collectionRoots(root, d)) {
            const dir = path.resolve(r.dir);
            if (target !== dir && !target.startsWith(dir + path.sep))
                continue;
            if (!best || dir.length > path.resolve(best.dir).length)
                best = r;
        }
    }
    return best?.repo ?? ".";
}
/**
 * Is `abs` inside a record root of some collection? The record watcher covers `data/`, `state/` and
 * `.dreamteamer/` outright; a module-owned collection or a record layer keeps its records elsewhere
 * (`git_modules/<m>/data/…`, `modules/<m>/data/…`), where most files — sources, a clone's `.git` —
 * are NOT records. A change there refreshes the tree only when this says so.
 */
export function isUnderRecordRoot(root, descriptors, abs) {
    const target = path.resolve(abs);
    for (const d of descriptors) {
        if (isRuntime(d))
            continue;
        for (const r of collectionRoots(root, d)) {
            const dir = path.resolve(r.dir);
            if (target === dir || target.startsWith(dir + path.sep))
                return true;
        }
    }
    return false;
}
function* walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith("."))
            continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory())
            yield* walk(p);
        else
            yield p;
    }
}
import { engine } from "./engine.js";
// ONE codec, and now ONE ENGINE: these delegate to the dreamteamer install the WORKSPACE pins
// (engine.ts), not to a copy bundled at extension build time. The rule is "one
// serializer or don't ship"; decision 48 tightened it — a bundled engine could still drift from
// the one `dt` runs on the command line, so the extension no longer carries one.
export function parseRecordText(text, d, bodyField) {
    return engine().parseRecordText(text, d, bodyField);
}
export function serializeRecord(d, fields) {
    return engine().serialize(d, fields);
}
export function bodyFieldOf(d) {
    return engine().bodyField(d);
}
export function parseRecord(file, d) {
    try {
        return engine().parseRecordText(fs.readFileSync(file, "utf8"), d);
    }
    catch {
        return {};
    }
}
// map an open file back to (descriptor, id) — reverse of filePath rules
export function fileToRecord(root, descriptors, fsPath) {
    // ⚠ LONGEST DIRECTORY WINS, not first-match. With namespaces, one collection's folder sitting under
    // another's prefix is ordinary (`data/health` vs `data/health/doctors`), and a first-match loop
    // answers whichever descriptor happened to be enumerated first — so the same open file resolved to
    // different collections depending on descriptor order. The engine's `pathToRecord` has always done
    // longest-prefix; this is the copy that had not learned it.
    //
    // ACROSS EVERY ROOT of every collection (engine 0.35.0): a record layer's file sits under
    // `git_modules/<layer>/data/<collection>/`, which is not the collection's write root — matching the
    // write root alone left a layer record unrecognised, with no form editor and no hover.
    const candidates = descriptors
        .flatMap((d) => collectionRoots(root, d).map(({ dir }) => ({ d, dir })))
        .filter(({ dir }) => fsPath.startsWith(dir + path.sep))
        .sort((a, b) => b.dir.length - a.dir.length);
    for (const { d, dir } of candidates) {
        const rel = path.relative(dir, fsPath);
        const storage = acc().storageOf(d);
        if (storage.shape === "folder") {
            const entry = storage.entry ?? "SKILL.md";
            const segs = rel.split(path.sep);
            if (segs.length === 2 && segs[1] === entry)
                return { d, id: segs[0] };
            // Deeper than the entry: a record of a collection stored UNDER this one (`storage.under`) —
            // `<id>/<subfolder>/<child id>.<suffix>.<ext>`. The engine's `pathToRecord` answers the same
            // way; this is the host-side copy, which also has to read runtime kinds.
            for (const child of placedUnder(descriptors, d)) {
                const pre = acc().storageOf(child).under.subfolder.split("/").join(path.sep) + path.sep;
                const sub = segs.slice(1).join(path.sep);
                if (!sub.startsWith(pre))
                    continue;
                const tail = recordTail(child);
                if (sub.endsWith(tail))
                    return { d: child, id: sub.slice(pre.length, -tail.length).split(path.sep).join("/") };
            }
            continue;
        }
        const id = recordIdOf(rel, d);
        if (id !== undefined)
            return { d, id };
    }
    return undefined;
}
/** `.<suffix>.<ext>` — the tail of a text record's filename. */
function recordTail(d) {
    const { suffix, format } = acc().storageOf(d);
    return `.${suffix}${EXT[format] ?? ""}`;
}
/**
 * The id a path INSIDE one root names, or undefined when it is no record of `d`. A text record ends in
 * its fixed tail; a BINARY record is `<id>.<suffix>.<ext>` with whatever extension the file has — the
 * extension is not derivable from the descriptor, which is why the fixed tail never matched one and
 * binary records were invisible to every walk here.
 */
function recordIdOf(rel, d) {
    const { suffix, format } = acc().storageOf(d);
    const slashed = rel.split(path.sep).join("/");
    if (format === "binary") {
        const m = slashed.match(new RegExp(`^(.+)\\.${(suffix ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[^./]+$`));
        return m ? m[1] : undefined;
    }
    const tail = recordTail(d);
    return slashed.endsWith(tail) ? slashed.slice(0, -tail.length) : undefined;
}
/** The collections whose records live inside `parent`'s record folders. */
function placedUnder(descriptors, parent) {
    return descriptors.filter((c) => acc().storageOf(c).under?.collection === parent.name);
}
/**
 * Every folder a record of `d` can sit in: its own root, then — for a collection stored under
 * another — the child folder inside each parent record's folder, in parent-id order, then each record
 * layer's folder (engine 0.35.0). The id of a record is its path inside WHICHEVER of these it is in,
 * which is what keeps it independent of placement. `descriptors` is looked up when the caller has
 * none; the parent's root is in it. Compile refuses a layer on a placed collection, so the two never
 * meet: a placed collection's list ends at its parents' folders.
 */
export function recordRoots(root, d, descriptors) {
    const [own, ...layers] = collectionRoots(root, d).map((r) => r.dir);
    const under = acc().storageOf(d).under;
    if (!under?.collection)
        return [own, ...layers];
    const parent = (descriptors ?? loadDescriptors(root)).find((x) => x.name === under.collection);
    if (!parent)
        return [own];
    const parentDir = collectionDir(root, parent);
    if (!fs.existsSync(parentDir))
        return [own];
    const roots = [own];
    for (const e of fs.readdirSync(parentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory() || e.name.startsWith("."))
            continue;
        roots.push(path.join(parentDir, e.name, ...under.subfolder.split("/")));
    }
    return roots;
}
/**
 * The file a record id names, or undefined. Computed for conventional storage — titling must never
 * parse a collection — and PROBED for a placed one: the id does not say which parent folder holds
 * it, so each candidate root is tried, which is one `existsSync` per parent and no walk.
 */
export function recordFileFor(root, d, id, descriptors) {
    const storage = acc().storageOf(d);
    const name = storage.shape === "folder" ? path.join(id, storage.entry ?? "SKILL.md") : `${id}${recordTail(d)}`;
    for (const dir of recordRoots(root, d, descriptors)) {
        const file = path.join(dir, name);
        if (fs.existsSync(file))
            return file;
    }
    return undefined;
}
export function listRecords(root, d) {
    const storage = acc().storageOf(d);
    const out = [];
    // stored under another collection: the whole logical collection is every root, ordered by id —
    // the same order the engine lists in, so a picker and `dt list` agree
    if (storage.under?.collection) {
        for (const r of recordRoots(root, d)) {
            if (!fs.existsSync(r))
                continue;
            for (const f of walk(r)) {
                const id = recordIdOf(path.relative(r, f), d);
                if (id !== undefined)
                    out.push({ id, file: f, fields: parseRecord(f, d) });
            }
        }
        return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    // Every root, write root first, then each record layer — the engine's order (`Store#_walkIds`).
    // ⚠ FIRST ROOT WINS on an id two roots hold, never last: a picker that offered whichever copy sorted
    // later would disagree with `dt get`, and the duplicate itself is `check`'s to report.
    const seen = new Set();
    for (const { dir } of collectionRoots(root, d)) {
        for (const r of listRoot(dir, d)) {
            if (seen.has(r.id))
                continue;
            seen.add(r.id);
            out.push(r);
        }
    }
    return out;
}
/** The records of `d` under ONE root, in walk order — a folder-shape record is its entry file. */
function listRoot(dir, d) {
    return [...walkIds(dir, d)].map(([id, file]) => ({ id, file, fields: parseRecord(file, d) }));
}
/**
 * id → file for the records of `d` under ONE root, in walk order, WITHOUT parsing a record — the walk
 * `listRoot` builds on and what a count or a duplicate check needs: a source's record count must not
 * cost a parse per record on every presentation read.
 */
export function walkIds(dir, d) {
    const out = new Map();
    if (!fs.existsSync(dir))
        return out;
    const storage = acc().storageOf(d);
    if (storage.shape === "folder") {
        for (const e of fs.readdirSync(dir).sort()) {
            if (e.startsWith("."))
                continue;
            const main = path.join(dir, e, storage.entry ?? "SKILL.md");
            if (fs.existsSync(main))
                out.set(e, main);
        }
        return out;
    }
    for (const f of walk(dir)) {
        const id = recordIdOf(path.relative(dir, f), d);
        if (id !== undefined)
            out.set(id, f);
    }
    return out;
}
/**
 * The ids MORE THAN ONE root of `d` holds, each with the roots holding it in the engine's order — the
 * write root's copy is the one read (`listRecords`, `Store#_walkIds`) and the later claimants are
 * `check`'s violation. Surfaced here because the Store's own duplicate memo is private and this host
 * walks every root anyway; empty for a collection with one root.
 */
export function duplicateIds(root, d, isStub) {
    return contestedIds(root, d, isStub).duplicates;
}
/**
 * Every id MORE THAN ONE root of `d` claims, split the way the engine resolves them (0.41.0, record-level
 * stubs): a claimant carrying `stub: true` YIELDS to any non-stub of its id in any root. So
 *
 *   duplicates   ids two or more NON-stubs claim — `check`'s violation, the `$duplicates` badge — with
 *                every claimant's root in root order (the first non-stub is the one read)
 *   stubs        ids a non-stub answers while stubs elsewhere yield to it — the roots holding those stubs
 *                (cr-vscode-004 line 9: the row says `● <root> stub · yields to <its root>`); and an id
 *                only stubs claim, whose first root's stub answers — the LATER roots, as the engine
 *                shadows them
 *
 * `isStub` reads ONE contested file's frontmatter — only claimants of a contested id are ever read, the
 * engine's own economy. Without it (an engine before stubs) every second claimant is a duplicate, as
 * before. The Store's own memo of this is not part of the engine's declared API, so the host derives it
 * from the roots it walks anyway.
 */
export function contestedIds(root, d, isStub) {
    const roots = collectionRoots(root, d);
    const duplicates = new Map();
    const stubs = new Map();
    if (roots.length < 2 || acc().storageOf(d).under?.collection)
        return { duplicates, stubs };
    const seen = new Map();
    for (const r of roots) {
        for (const [id, file] of walkIds(r.dir, d))
            seen.set(id, [...(seen.get(id) ?? []), { r, file }]);
    }
    for (const [id, claims] of seen) {
        if (claims.length < 2)
            continue;
        if (!isStub) {
            duplicates.set(id, claims.map((c) => c.r));
            continue;
        }
        const real = claims.filter((c) => !isStub(c.file));
        if (real.length > 1)
            duplicates.set(id, real.map((c) => c.r));
        if (real.length >= 1 && real.length < claims.length)
            stubs.set(id, claims.filter((c) => !real.includes(c)).map((c) => c.r));
        // stubs ONLY: the first root's stub answers and the engine shadows the rest (`resolveClaims`,
        // `claims.slice(1)`) — the row names those roots too (cr-vscode-004 review, stub-memo-rederived-on-host)
        if (real.length === 0)
            stubs.set(id, claims.slice(1).map((c) => c.r));
    }
    return { duplicates, stubs };
}
/** The fields a field verb (remove, rename) can act on: the resolved list minus the three the engine
 *  injects — `id`, `last_modified` (virtual) and `created` (derived) — which no verb may touch. */
export function fieldVerbTargets(d) {
    return Object.entries(acc().fieldsOf(d))
        .filter(([, f]) => !f.virtual && !f.derived)
        .map(([k]) => k);
}
export function titleField(d) {
    const fields = acc().fieldsOf(d);
    return ["title", "name", "subject"].find((f) => f in fields && !fields[f].virtual);
}
export function recordLabel(d, r) {
    const tf = titleField(d);
    const v = tf ? r.fields[tf] : undefined;
    return typeof v === "string" && v.trim() ? v : r.id;
}
/** The compiled record behind a `ui-view` — its id IS its filename (see `loadUiViews`). */
export function uiViewFile(root, v) {
    return path.join(systemDir(root, "ui-views"), `${v.id}.ui-view.yaml`);
}
export function loadUiViews(root) {
    const dir = systemDir(root, "ui-views");
    if (!fs.existsSync(dir))
        return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".ui-view.yaml"))
            continue;
        try {
            const v = yaml.load(fs.readFileSync(path.join(dir, f), "utf8"));
            v.id = f.slice(0, -".ui-view.yaml".length);
            out.push(v);
        }
        catch { }
    }
    return out.sort((a, b) => (a.display?.nav?.order ?? 999) - (b.display?.nav?.order ?? 999));
}
// engine's slugOrHash (template.js) — @me resolves to slugOrHash(git user.name)
export function operatorId(root) {
    try {
        const name = execFileSync("git", ["config", "user.name"], { cwd: root }).toString().trim();
        const s = name
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (s)
            return s;
        let h = 0;
        for (const ch of name)
            h = (h * 31 + ch.codePointAt(0)) >>> 0;
        return "x" + h.toString(36).padStart(7, "0");
    }
    catch {
        return null;
    }
}
// minimal filter matcher: {field: value} | {field: {_eq: v}} | {_and: [...]}
// covers what a workspace's ui-views use today (inbox: assignee _eq @me).
// '@me' resolves to `users/<operator>` — same rule as studio's ui-views.ts
export function matchesFilter(fields, filter, me) {
    const meRef = me ? `users/${me}` : null;
    for (const [k, v] of Object.entries(filter ?? {})) {
        if (k === "_and") {
            if (!v.every((f) => matchesFilter(fields, f, me)))
                return false;
        }
        else if (k === "_or") {
            if (!v.some((f) => matchesFilter(fields, f, me)))
                return false;
        }
        else if (v !== null && typeof v === "object") {
            const expected = "_eq" in v ? v._eq : undefined;
            const resolved = expected === "@me" ? meRef : expected;
            if ("_eq" in v && String(fields[k] ?? "") !== String(resolved ?? ""))
                return false;
            if ("_neq" in v && String(fields[k] ?? "") === String(v._neq === "@me" ? meRef : v._neq))
                return false;
            if ("_contains" in v && !String(fields[k] ?? "").includes(String(v._contains)))
                return false;
        }
        else {
            const resolved = v === "@me" ? meRef : v;
            if (String(fields[k] ?? "") !== String(resolved ?? ""))
                return false;
        }
    }
    return true;
}
