// Ported from the dreamteamer VS Code extension's host side (src/fsdata.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as yaml from "js-yaml";
export const EXT = { md: ".md", yaml: ".yaml", json: ".json" };
const acc = () => engine().descriptor;
export function viewDisplay(v) {
    return v.compiled?.display ?? v.display ?? {};
}
export function viewLabel(v) {
    return v.display?.nav?.title ?? v.title ?? v.name ?? v.id;
}
export function navViewsOf(views, collection) {
    return views.filter((v) => v.scope === "collection" && !!v.display?.nav && viewCollection(v) === collection);
}
export function viewRow(v) {
    const layout = viewDisplay(v).list?.layout;
    return {
        label: viewLabel(v),
        icon: v.display?.nav?.icon ?? "bookmark",
        description: layout && layout !== "table" ? layout : undefined,
        tooltip: `\`${v.route}\`  \n_saved view of ${viewCollection(v)}_`,
    };
}
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
export function isRuntime(d) {
    return acc().isRuntime(d);
}
export function isInternal(d) {
    return acc().isInternal(d);
}
export function systemDir(root, kind) {
    const flat = path.join(root, ".dreamteamer", kind);
    if (fs.existsSync(flat))
        return flat;
    const nested = path.join(root, ".dreamteamer", "system", kind);
    return fs.existsSync(nested) ? nested : flat;
}
export function moduleDependencies(root) {
    return new Map(loadModules(root).filter((m) => m.dependencies?.length).map((m) => [m.id, m.dependencies]));
}
export function moduleNamespaces(root) {
    return new Map(loadModules(root).filter((m) => m.namespaces?.length).map((m) => [m.id, m.namespaces]));
}
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
export function loadDescriptors(root) {
    const order = (d) => acc().displayOf(d).nav?.order ?? 999;
    return [...(engine().loadDescriptors(root)?.values() ?? [])].sort((a, b) => order(a) - order(b));
}
export function collectionRoots(root, d) {
    const s = acc().storageOf(d);
    const base = isRuntime(d) ? path.join(root, ".dreamteamer") : root;
    return s.roots.map((r) => ({
        dir: path.resolve(base, r.path),
        repo: r.repo ?? s.repo ?? ".",
        ...(r.layer ? { layer: r.layer } : {}),
    }));
}
export function collectionDir(root, d) {
    return collectionRoots(root, d)[0].dir;
}
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
export function fileToRecord(root, descriptors, fsPath) {
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
function recordTail(d) {
    const { suffix, format } = acc().storageOf(d);
    return `.${suffix}${EXT[format] ?? ""}`;
}
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
function placedUnder(descriptors, parent) {
    return descriptors.filter((c) => acc().storageOf(c).under?.collection === parent.name);
}
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
function listRoot(dir, d) {
    return [...walkIds(dir, d)].map(([id, file]) => ({ id, file, fields: parseRecord(file, d) }));
}
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
export function duplicateIds(root, d) {
    return contestedIds(root, d).duplicates;
}
export function contestedIds(root, d) {
    const roots = collectionRoots(root, d);
    const duplicates = new Map();
    if (roots.length < 2 || acc().storageOf(d).under?.collection)
        return { duplicates };
    const seen = new Map();
    for (const r of roots) {
        for (const [id, file] of walkIds(r.dir, d))
            seen.set(id, [...(seen.get(id) ?? []), { r, file }]);
    }
    for (const [id, claims] of seen) {
        if (claims.length > 1)
            duplicates.set(id, claims.map((c) => c.r));
    }
    return { duplicates };
}
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
