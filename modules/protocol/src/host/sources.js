// WHERE A RECORD COMES FROM — computed here, by the extension, from the roots it already reads.
//
// Engine 0.35.0 made a collection a stack of roots: the workspace's own data on top (the write
// root), each record layer it lists below it (another workspace cloned under `git_modules/`), and
// the folder a module-owned collection (`storage.owner: module`) keeps its one shared list in. Every
// record file sits in exactly one root, and `storageOf(d).roots` names each root with its path and
// its repo. The SOURCE of a record is the NAME of the root it was read from — never a path:
//
//   own     the workspace's `package.json` name          `my-hq`
//   layer   the layer's `git_modules` key                 `project-a`
//   module  the owning module's bare id                   `org`
//
// It is NOT an engine field (design 2026-10-28, reviewed): compile, store and check never read it, a
// field name is reserved in every workspace forever, and `dt get --json` already carries `file`
// beside the compiled roots for a script that wants the fact. So it travels on the wire as the
// extension's own `$source` — a `$`-synthetic key like `$last-modified-by`, which the adapter never
// persists — and the webview draws it with one component. ⚠ Not `source`: a module may author a
// record field called `source` (a provenance quad does), and the list row spreads the record's
// fields at the top level, so a bare `source` would overwrite a real value.
//
// The mark means "read from" and nothing else. Where an edit COMMITS is `repoOfPath` (an inline
// module's records commit to the workspace while their source is the module), and the commit action
// alone says that.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { engine } from "./engine.js";
import { collectionRoots, listRecords, loadModules, walkIds, workspaceName } from "./fsdata.js";
/**
 * Build the context from the workspace: the root package (name, `git_modules`), the compiled module
 * records (a module's `path`, to tell a module-owned write root from the workspace's own), the
 * `repos` records (to match a remote), and each installed clone's origin.
 */
export function sourcesContext(root, iterable) {
    // ⚠ ONCE, into an array: the panel passes `store.descriptors.values()`, a one-shot iterator, and the
    // `repos` walk below would exhaust it before `layerKeys` reads it — an empty layer set, silently
    const descriptors = [...iterable];
    let gitModules = {};
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        const raw = pkg?.dreamteamer?.git_modules;
        if (raw && typeof raw === "object")
            gitModules = raw;
    }
    catch {
        /* no package — no git modules */
    }
    const repos = [];
    for (const d of descriptors) {
        if (d.name !== "repos")
            continue;
        for (const r of collectionRoots(root, d)) {
            for (const [id, file] of walkIds(r.dir, d)) {
                try {
                    const fields = engine().parseRecordText(fs.readFileSync(file, "utf8"), d);
                    if (typeof fields.url === "string" && fields.url)
                        repos.push({ id, url: fields.url });
                }
                catch {
                    /* an unreadable repos record matches nothing */
                }
            }
        }
    }
    const origins = new Map();
    for (const name of Object.keys(gitModules)) {
        const repo = path.posix.join("git_modules", name);
        const dir = path.join(root, repo);
        if (!fs.existsSync(path.join(dir, ".git")))
            continue;
        try {
            origins.set(repo, execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined);
        }
        catch {
            origins.set(repo, undefined);
        }
    }
    return { root, workspace: workspaceName(root), modules: loadModules(root), gitModules, repos, origins, layers: layerKeys(gitModules, descriptors) };
}
/**
 * WHICH `git_modules` ENTRIES ARE RECORD LAYERS — the engine's answer, read, never re-derived. Engine
 * 0.41.0 made `records:` optional narrowing: a clone whose own manifest names `workspace_module` is a
 * layer read whole, so is an entry with `module: true`, and so is one declared and not cloned (announced
 * as a layer not installed); a clone naming no workspace module stays a bundle. The engine's
 * `layerEntries` decides it and compile writes the outcome into every layerable collection's roots, so
 * a key is a layer when the compiled runtime names it as a layer root — whatever engine the workspace
 * pins, which keeps an engine below 0.41.0 (the floor is 0.36.0) from having a records-less clone called
 * a layer it does not read. An entry listing `records` is a layer on every engine, and stays one when
 * no compiled collection takes it (the Sources section is where "why is nothing read" is answered).
 */
export function layerKeys(gitModules, descriptors) {
    const out = new Set();
    for (const [name, entry] of Object.entries(gitModules))
        if (entry && entry.records !== undefined)
            out.add(name);
    for (const d of descriptors)
        for (const l of engine().descriptor.storageOf(d).layers ?? [])
            if (l.name in gitModules)
                out.add(l.name);
    return out;
}
/**
 * Two git remotes naming one repository. Exact after the spellings every clone varies — a trailing
 * `.git`, a trailing slash, case — and NOTHING cleverer: a host alias in an SSH config (`host-work`
 * for `host`) is a fact about one machine, and guessing at it would link a source to the wrong
 * `repos` record with no error anywhere. A clone's own `origin` is asked as well as the declared
 * `url`, so the alias the operator cloned with matches the record spelled the same way.
 */
export function sameRemote(a, b) {
    if (!a || !b)
        return false;
    const norm = (u) => u.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
    return norm(a) === norm(b);
}
/** The `repos` record matching any of these remotes, as a reference, or undefined. */
export function repoRecordFor(remotes, repos) {
    for (const remote of remotes) {
        const hit = repos.find((r) => sameRemote(remote, r.url));
        if (hit)
            return `repos/${hit.id}`;
    }
    return undefined;
}
/** The module that owns `d`, and whether the write root sits inside that module's folder. */
function owningModule(root, d, write, ctx) {
    const id = engine().descriptor.moduleOf(d);
    if (!id)
        return undefined;
    const mod = ctx.modules.find((m) => m.id === id);
    const rel = path.relative(root, write.dir).split(path.sep).join("/");
    // the module record says where the module's folder is; a write root inside it is the module's
    // shared list, kept in the module's clone or its inline folder
    if (mod?.path && mod.path !== "." && (rel === mod.path || rel.startsWith(mod.path + "/")))
        return mod;
    // no path to compare against: a write root committed to another repo can only be a module's
    if (!mod?.path && write.repo !== ".")
        return mod ?? { id, name: id };
    return undefined;
}
/**
 * Every root of `d`, NAMED, in the engine's order (write root first) with the records each one is
 * read for. The one derivation behind the list row's `$source`, the collection row's `sources`, the
 * tree's "from org", the hover's "from project-a" and the Sources section.
 */
export function collectionSources(root, d, ctx) {
    const roots = collectionRoots(root, d);
    const counts = countsByRoot(root, d, roots);
    return roots.map((r, i) => {
        const rel = path.relative(root, r.dir).split(path.sep).join("/");
        if (r.layer) {
            const declared = ctx.gitModules[r.layer]?.url;
            const installed = fs.existsSync(path.join(root, r.repo));
            return {
                name: r.layer,
                kind: "layer",
                repo: r.repo,
                path: rel,
                installed,
                count: counts[i] ?? 0,
                ...withRecord(repoRecordFor([declared, ctx.origins.get(r.repo)], ctx.repos)),
                ...layerAccess(root, r.layer, r.repo, d.name, installed),
            };
        }
        const mod = owningModule(root, d, r, ctx);
        if (mod) {
            const key = mod.path?.startsWith("git_modules/") ? mod.path.slice("git_modules/".length) : undefined;
            const declared = key ? ctx.gitModules[key]?.url : undefined;
            return {
                name: mod.id,
                kind: "module",
                repo: r.repo,
                path: rel,
                installed: fs.existsSync(r.dir) || r.repo === ".",
                count: counts[i] ?? 0,
                ...withRecord(repoRecordFor([declared, ctx.origins.get(r.repo)], ctx.repos)),
                ...moduleFolderAccess(mod.id, mod.path ?? rel, root),
            };
        }
        return { name: ctx.workspace, kind: "own", repo: r.repo, path: rel, installed: true, count: counts[i] ?? 0, via: "own", access: "write" };
    });
}
/**
 * Is a module folder an INSTALLED PACKAGE — under `node_modules` once symlinks are resolved? A package
 * `dt-setup link`ed to a modules clone is a symlink out of `node_modules` into a git working tree, and
 * a write to it lands in that clone; a registry install is replaced on the next `npm install`. Without
 * a root to resolve against (a pure test), the path alone answers.
 */
export function isInstalledPackage(rel, root) {
    if (!rel.split("/").includes("node_modules"))
        return false;
    if (!root)
        return true;
    try {
        return fs.realpathSync(path.join(root, rel)).split(path.sep).includes("node_modules");
    }
    catch {
        return true; // a folder that does not resolve is not a clone anyone can write to
    }
}
/** A module folder's class and writability: a package is read-only here, anything else is a clone. */
function moduleFolderAccess(id, rel, root) {
    return isInstalledPackage(rel, root)
        ? { via: "package", access: "read", note: `${id} is an installed package — nothing is written to it from this workspace; change it in the package's own repo` }
        : { via: "clone", access: "write" };
}
/**
 * A record layer's writability for ONE collection. Installed and compiled for it: `write` — a new
 * record is added there through the layer's own workspace, as `dt add <c> -w <layer>` adds it (engine
 * 0.41.0), which needs the layer's runtime. Installed but not compiled for it: `edit` — its records are
 * edited in place (the engine writes a layer file where it is), and the note names the command that
 * makes it a target. Not installed: `read`, nothing is read from it either.
 */
export function layerAccess(root, layer, repo, collection, installed) {
    if (!installed)
        return { via: "layer", access: "read", note: `${layer} is declared but not installed — run \`dreamteamer install\`; nothing is read from it` };
    if (layerCompiles(root, repo, collection))
        return { via: "layer", access: "write" };
    return {
        via: "layer",
        access: "edit",
        note: `${layer} has no compiled ${collection ?? "runtime"} — its records are edited in place, and a new one is added there once \`dt compile -w ${layer}\` has run`,
    };
}
/** Has the layer's clone compiled this collection (or, with none named, anything at all) — the runtime
 *  a write in the layer's own workspace reads? */
export function layerCompiles(root, repo, collection) {
    const runtime = path.join(root, repo, ".dreamteamer");
    return fs.existsSync(collection === undefined ? path.join(runtime, "manifest.yaml") : path.join(runtime, "collections", `${collection}.collection.yaml`));
}
/**
 * THE SOURCE OF A RUNTIME ROW — a skill, a command, an agent, a collection descriptor (operator
 * 2026-10-29: "all list views should have sources filter, skills, commands, agents"). Every one is
 * read from `.dreamteamer/`, ONE root, so the root says nothing; where it comes from is the module it
 * was compiled from, named the way a record's root is named, so the picker and the dot colour mean
 * the same thing on both kinds of list:
 *
 *   own     a module inside the workspace repo (`modules/…`, the root) — the workspace's name
 *   layer   a module a record layer brought (`git_modules/<key>/…`, `<key>` a layer by
 *           `layerKeys` — records listed, or read whole) — the layer's key, the same word its
 *           records are marked with
 *   module  anything else — an npm install, a `git_modules` bundle — the module's id
 *
 * A row no module claims (no manifest entry) is the workspace's own.
 */
export function moduleSource(mod, ctx) {
    const p = mod?.path?.replace(/\/+$/, "") ?? "";
    const parts = p.split("/");
    const clone = parts[0] === "git_modules" && parts[1] ? parts[1] : undefined;
    if (!mod || (!clone && !parts.includes("node_modules")))
        return { name: ctx.workspace, kind: "own", repo: ".", path: p || ".", installed: true, via: "own", access: "write" };
    const repo = clone ? `git_modules/${clone}` : ".";
    const record = withRecord(repoRecordFor([clone ? ctx.gitModules[clone]?.url : undefined, ctx.origins.get(repo)], ctx.repos));
    // a system write into a layer's module lands in the layer's clone and commits there — a write
    if (clone && ctx.layers.has(clone))
        return { name: clone, kind: "layer", repo, path: p, installed: true, ...record, via: "layer", access: "write" };
    return { name: mod.id, kind: "module", repo, path: p, installed: true, ...record, ...moduleFolderAccess(mod.id, p, ctx.root) };
}
/** A runtime kind's sources, one per distinct `moduleSource` of its rows, counted — own, then the
 *  layers, then the modules, each by name. `modules` is the module id of every row. */
export function runtimeSources(modules, ctx) {
    const byName = new Map();
    for (const id of modules) {
        const s = moduleSource(id ? ctx.modules.find((m) => m.id === id) : undefined, ctx);
        const entry = byName.get(s.name) ?? byName.set(s.name, { ...s, count: 0 }).get(s.name);
        entry.count++;
    }
    const rank = { own: 0, layer: 1, module: 2 };
    return [...byName.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
}
function withRecord(record) {
    return record ? { record } : {};
}
/** Records read from each root: ids the root is the FIRST to claim, in root order. A collection stored
 *  UNDER another (`storage.under`) has one root whose records also sit in each parent record's folder —
 *  counting the fallback folder alone said 1 for a collection of 2. Compile refuses a layer on a placed
 *  collection, so its one root holds the whole union. */
function countsByRoot(root, d, roots) {
    if (engine().descriptor.storageOf(d).under?.collection)
        return [listRecords(root, d).length];
    const seen = new Set();
    return roots.map((r) => {
        let n = 0;
        for (const id of walkIds(r.dir, d).keys()) {
            if (seen.has(id))
                continue;
            seen.add(id);
            n++;
        }
        return n;
    });
}
/**
 * The source a FILE of `d` was read from — the longest root containing it, the same rule
 * `fileToRecord` and the engine's `layerOfFile` follow. The write root's entry when no layer holds
 * the file (which is what `Store#layerOfFile`'s null means). Undefined for a file in no root.
 */
export function sourceOfFile(root, d, file, sources) {
    const target = path.resolve(file);
    let best;
    for (const s of sources) {
        const dir = path.resolve(root, s.path);
        if (target !== dir && !target.startsWith(dir + path.sep))
            continue;
        if (!best || dir.length > path.resolve(root, best.path).length)
            best = s;
    }
    return best;
}
/**
 * What a collection row SAYS about its sources, for a tree row or a hover: the foreign roots that
 * actually hold records — the workspace's own root is never counted, so a workspace using neither
 * layers nor module-owned lists reads exactly as before.
 *
 *   one foreign root     `from org`
 *   several              `from 3 layers` (`from 2 sources` when they mix layers and a module)
 *   an absent layer      `· project-a not installed` appended — no count, no mark
 */
export function describeSources(sources) {
    const foreign = sources.filter((s) => s.kind !== "own");
    const holding = foreign.filter((s) => s.count > 0);
    const absent = foreign.filter((s) => !s.installed);
    const parts = [];
    if (holding.length === 1)
        parts.push(`from ${holding[0].name}`);
    else if (holding.length > 1) {
        const kinds = new Set(holding.map((s) => s.kind));
        parts.push(`from ${holding.length} ${kinds.size === 1 && kinds.has("layer") ? "layers" : "sources"}`);
    }
    for (const s of absent)
        parts.push(`${s.name} not installed`);
    const detail = sources.map((s) => (s.installed ? `${s.name} (${s.kind}) — ${s.count} record${s.count === 1 ? "" : "s"}` : `${s.name} (${s.kind}) — not installed`));
    return { ...(parts.length ? { description: parts.join(" · ") } : {}), detail };
}
/**
 * The filter WITHOUT its `$source` clauses — what the source picker counts over, so a source the
 * operator has not picked still says how many records it holds rather than 0. Only an AND (or a single
 * clause) can lose a clause without changing what the rest means; an OR is returned as it is, and the
 * counts then follow the full filter, as they did before the picker. Undefined when nothing is left.
 */
export function withoutSourceClauses(filter) {
    const isSource = (c) => !!c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 1 && "$source" in c;
    if (isSource(filter))
        return undefined;
    if (filter && typeof filter === "object" && !Array.isArray(filter) && Array.isArray(filter._and) && Object.keys(filter).length === 1) {
        const rest = filter._and.filter((c) => !isSource(c));
        return rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : { _and: rest };
    }
    return filter;
}
/**
 * THE STACK, top to bottom, as `dt status` prints its `layers:` block — the workspace's own data,
 * each declared layer (installed or not, with the collections it contributes and their counts), and
 * each module-owned collection under its module. Derived from the compiled roots across every
 * descriptor plus the root package's `git_modules`; a layer declared but contributing to no compiled
 * collection is still listed, because the Sources section is where "why is nothing read from it"
 * gets answered.
 */
export function sourcesStack(root, descriptors, ctx) {
    const workspace = { name: ctx.workspace, kind: "own", repo: ".", installed: true, via: "own", access: "write", collections: [] };
    const layers = new Map();
    const modules = new Map();
    // declared layers first, so one with no compiled collection still appears
    for (const [name, entry] of Object.entries(ctx.gitModules)) {
        if (!entry || !ctx.layers.has(name))
            continue;
        const repo = path.posix.join("git_modules", name);
        const installed = fs.existsSync(path.join(root, repo));
        layers.set(name, {
            name,
            kind: "layer",
            repo,
            installed,
            ...layerAccess(root, name, repo, undefined, installed),
            ...(entry.url ? { url: entry.url } : {}),
            ...withRecord(repoRecordFor([entry.url, ctx.origins.get(repo)], ctx.repos)),
            collections: [],
        });
    }
    for (const d of descriptors) {
        if (engine().descriptor.isRuntime(d))
            continue;
        for (const s of collectionSources(root, d, ctx)) {
            const row = { collection: d.name, path: s.path, count: s.count };
            if (s.kind === "own")
                workspace.collections.push(row);
            else if (s.kind === "layer") {
                const l = layers.get(s.name) ?? (layers.set(s.name, { ...stripCount(s), collections: [] }), layers.get(s.name));
                l.collections.push(row);
            }
            else {
                const key = s.repo.startsWith("git_modules/") ? s.repo.slice("git_modules/".length) : undefined;
                const url = key ? ctx.gitModules[key]?.url : undefined;
                const m = modules.get(s.name) ?? (modules.set(s.name, { ...stripCount(s), ...(url ? { url } : {}), collections: [] }), modules.get(s.name));
                m.collections.push(row);
            }
        }
    }
    return { workspace, layers: [...layers.values()], modules: [...modules.values()] };
}
function stripCount(s) {
    const { count: _c, path: _p, ...rest } = s;
    return rest;
}
/**
 * A record layer's AUTHORED title, if its clone's `package.json` carries one — `dreamteamer.title`
 * first (where a module titles itself), then a top-level `title`. Undefined for an absent clone, an
 * unreadable package or no title; the nav then derives a label from the key (`layerLabels`).
 */
export function layerTitle(root, key) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "git_modules", key, "package.json"), "utf8"));
        const title = pkg?.dreamteamer?.title ?? pkg?.title;
        return typeof title === "string" && title.trim() ? title.trim() : undefined;
    }
    catch {
        return undefined;
    }
}
