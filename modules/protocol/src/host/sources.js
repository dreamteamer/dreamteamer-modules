// Ported from the dreamteamer VS Code extension's host side (src/sources.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { engine } from "./engine.js";
import { collectionRoots, listRecords, loadModules, walkIds, workspaceName } from "./fsdata.js";
export function sourcesContext(root, iterable) {
    const descriptors = [...iterable];
    let gitModules = {};
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        const raw = pkg?.dreamteamer?.git_modules;
        if (raw && typeof raw === "object")
            gitModules = raw;
    }
    catch {
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
export function sameRemote(a, b) {
    if (!a || !b)
        return false;
    const norm = (u) => u.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
    return norm(a) === norm(b);
}
export function repoRecordFor(remotes, repos) {
    for (const remote of remotes) {
        const hit = repos.find((r) => sameRemote(remote, r.url));
        if (hit)
            return `repos/${hit.id}`;
    }
    return undefined;
}
function owningModule(root, d, write, ctx) {
    const id = engine().descriptor.moduleOf(d);
    if (!id)
        return undefined;
    const mod = ctx.modules.find((m) => m.id === id);
    const rel = path.relative(root, write.dir).split(path.sep).join("/");
    if (mod?.path && mod.path !== "." && (rel === mod.path || rel.startsWith(mod.path + "/")))
        return mod;
    if (!mod?.path && write.repo !== ".")
        return mod ?? { id, name: id };
    return undefined;
}
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
export function isInstalledPackage(rel, root) {
    if (!rel.split("/").includes("node_modules"))
        return false;
    if (!root)
        return true;
    try {
        return fs.realpathSync(path.join(root, rel)).split(path.sep).includes("node_modules");
    }
    catch {
        return true;
    }
}
function moduleFolderAccess(id, rel, root) {
    return isInstalledPackage(rel, root)
        ? { via: "package", access: "read", note: `${id} is an installed package — nothing is written to it from this workspace; change it in the package's own repo` }
        : { via: "clone", access: "write" };
}
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
export function layerCompiles(root, repo, collection) {
    const runtime = path.join(root, repo, ".dreamteamer");
    return fs.existsSync(collection === undefined ? path.join(runtime, "manifest.yaml") : path.join(runtime, "collections", `${collection}.collection.yaml`));
}
export function moduleSource(mod, ctx) {
    const p = mod?.path?.replace(/\/+$/, "") ?? "";
    const parts = p.split("/");
    const clone = parts[0] === "git_modules" && parts[1] ? parts[1] : undefined;
    if (!mod || (!clone && !parts.includes("node_modules")))
        return { name: ctx.workspace, kind: "own", repo: ".", path: p || ".", installed: true, via: "own", access: "write" };
    const repo = clone ? `git_modules/${clone}` : ".";
    const record = withRecord(repoRecordFor([clone ? ctx.gitModules[clone]?.url : undefined, ctx.origins.get(repo)], ctx.repos));
    if (clone && ctx.layers.has(clone))
        return { name: clone, kind: "layer", repo, path: p, installed: true, ...record, via: "layer", access: "write" };
    return { name: mod.id, kind: "module", repo, path: p, installed: true, ...record, ...moduleFolderAccess(mod.id, p, ctx.root) };
}
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
export function sourcesStack(root, descriptors, ctx) {
    const workspace = { name: ctx.workspace, kind: "own", repo: ".", installed: true, via: "own", access: "write", collections: [] };
    const layers = new Map();
    const modules = new Map();
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
            ...(declaredUrl(ctx, name) ? { url: declaredUrl(ctx, name) } : {}),
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
                const url = declaredUrl(ctx, key);
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
/**
 * A url with its USERINFO removed (cr-vscode-012, held-out h5 and h7, and the line "a
 * scp-like user@host:path remote never shows its login") — what the host may SEND. A `scheme://` url
 * of ANY scheme loses everything between `//` and the last `@` of its authority (a token pasted as
 * `https://<token>@host/…`, and an `ssh://` login, alike); the scheme, host, port and path are kept as
 * written. A url `new URL` refuses (a raw `/` in a password) is cut at its LAST `@`, so a secret is
 * never left behind by a parse that gave up. An scp-like `user@host:path` becomes `host:path`, split at
 * the LAST `@` before the first `:` as ssh splits it; a local path (a `/` before that `:`), a drive path
 * and a login-free `host:path` are returned unchanged. Matching a remote (`repoRecordFor`) still reads
 * the raw url: that is local and never sent.
 */
export function withoutUserinfo(url) {
    if (typeof url !== "string")
        return url;
    const m = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/is.exec(url);
    if (!m) {
        // scp-like: `user@host:path` — the part before the first `:` names the login and host, unless it
        // holds a `/` (then it is a local path, as git reads it)
        const colon = url.indexOf(":");
        if (colon === -1)
            return url;
        const head = url.slice(0, colon);
        const at = head.lastIndexOf("@");
        if (at === -1 || head.includes("/") || url.startsWith("//", colon + 1))
            return url;
        return url.slice(at + 1);
    }
    const [, scheme, rest] = m;
    let at;
    try {
        new URL(url);
        const end = rest.search(/[/?#]/);
        at = (end === -1 ? rest : rest.slice(0, end)).lastIndexOf("@");
    }
    catch {
        at = rest.lastIndexOf("@");
    }
    if (at === -1)
        return url;
    return `${scheme}${rest.slice(at + 1)}`;
}
/** The declared `git_modules` url of a key, as the host may send it — the ONE reader `sourcesStack` uses
 *  for a layer's and a module bundle's `url`, so neither site can send userinfo. */
export function declaredUrl(ctx, key) {
    return key ? withoutUserinfo(ctx.gitModules[key]?.url) || undefined : undefined;
}
