// Ported from the dreamteamer VS Code extension's host side (src/nav.ts); PROTOCOL.md is the contract it answers.
import { engine } from "./engine.js";
import { isInternal, isRuntime, loadDescriptors, loadModules, moduleDependencies, moduleNamespaces, navViewsOf, viewRow, workspaceModule } from "./fsdata.js";
import { describeSources } from "./sources.js";
export function keepsRuntimeRecords(d) {
    return engine().descriptor.overlaidByOf(d).length > 0;
}
export function shouldFoldOutOfRecordTree(d) {
    return isInternal(d) && !keepsRuntimeRecords(d);
}
export function routeFor(d) {
    return isInternal(d) ? `/settings/system/${d.name}` : `/content/${d.name}`;
}
export function collectionRow(d, sources) {
    const { titleOf, displayOf, storageOf } = engine().descriptor;
    const count = sources ? sources.reduce((n, s) => n + (s.installed ? s.count : 0), 0) : undefined;
    const row = { label: titleOf(d), icon: displayOf(d).nav?.icon, tooltip: storageOf(d).path, ...(count !== undefined ? { count } : {}) };
    if (!sources?.some((s) => s.kind !== "own"))
        return row;
    const { description, detail } = describeSources(sources);
    const shared = sources.some((s) => s.kind !== "own" && s.count > 0);
    const head = shared ? `Shared · ${description}` : description;
    const tooltip = [...(head ? [head] : []), storageOf(d).path, "", ...detail].join("\n");
    return { ...row, tooltip, ...(shared ? { shared: true } : {}) };
}
export function folderModule(folder, modules) {
    const has = (id) => (id && modules.some((m) => m.id === id) ? id : undefined);
    if ("layer" in folder)
        return has(folder.layer);
    if (folder.key.startsWith("mod:"))
        return has(folder.key.slice(4));
    if (folder.key.startsWith("ns:")) {
        const ns = folder.key.slice(3);
        return modules.find((m) => m.namespaces?.includes(ns))?.id;
    }
    if (folder.key.startsWith("grp:")) {
        const held = new Set((folder.collections ?? []).map((d) => d.name));
        if (!held.size)
            return undefined;
        return modules.find((m) => {
            const ships = (m.collections ?? []).map((c) => c.replace(/^collections\//, ""));
            return ships.length === held.size && ships.every((c) => held.has(c));
        })?.id;
    }
    return undefined;
}
export const MODULE_ICON = "deployed_code";
export const PLAIN_FOLDER_ICON = "folder-compact";
export const MODULE_MARK = "•";
export const SHARED_MARK = "⚭";
export function rowMarks(marks) {
    return marks.module ? MODULE_MARK : marks.shared ? SHARED_MARK : undefined;
}
export function moduleIcon(module, look) {
    const shipped = (module?.collections ?? [])
        .map((ref, i) => ({ i, ...(look(ref.replace(/^collections\//, "")) ?? {}) }))
        .filter((c) => c.icon && !c.runtime)
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.i - b.i);
    return shipped[0]?.icon;
}
export function folderPresentation(module, about, opts = {}) {
    const marks = rowMarks({ module: Boolean(module), shared: opts.shared });
    if (!module)
        return { icon: PLAIN_FOLDER_ICON, ...(about ? { tooltip: about } : {}), ...(marks ? { marks } : {}) };
    return { icon: opts.icon ?? MODULE_ICON, tooltip: `${about ? `${about} — ` : ""}module ${module}${opts.source ? ` · ${opts.source}'s records` : ""} · click for its page`, route: moduleRoute(module, opts.source), ...(marks ? { marks } : {}) };
}
export const WORKSPACE_ROUTE = "/settings/schema/activity";
export function moduleRoute(id, source) {
    return `/settings/schema/activity?module=${encodeURIComponent(id)}${source ? `&source=${encodeURIComponent(source)}` : ""}`;
}
export function groupTopLevel(descriptors, declared, workspaceModule, dependsOn, navGroups, namespacesOf, titleOf = new Map()) {
    const byLength = [...declared].sort((a, b) => b.length - a.length);
    const namespaceOf = (name) => byLength.find((ns) => name.startsWith(ns + "/")) ?? "";
    const foldModuleOf = (d) => {
        if (!workspaceModule || namespaceOf(d.name))
            return undefined;
        const id = isRuntime(d) ? engine().descriptor.overlaidByOf(d)[0] : engine().descriptor.moduleOf(d);
        return id && id !== workspaceModule ? id : undefined;
    };
    const perModule = new Map();
    for (const d of descriptors) {
        const id = foldModuleOf(d);
        if (id)
            perModule.set(id, (perModule.get(id) ?? 0) + 1);
    }
    const folds = (id) => (perModule.get(id) ?? 0) >= 2;
    const hostModuleOf = (id) => {
        if (folds(id))
            return id;
        for (const ref of dependsOn?.get(id) ?? []) {
            const dep = ref.replace(/^modules\//, "");
            if (dep !== id && folds(dep))
                return dep;
        }
        return undefined;
    };
    const groupOfModule = new Map();
    for (const [key, ids] of navGroups ?? [])
        for (const id of ids)
            groupOfModule.set(id, key);
    const homeNamespaceOf = (id) => {
        const own = (namespacesOf?.get(id) ?? []).filter((ns) => declared.includes(ns));
        if (own.includes(id))
            return id;
        const roots = own.filter((ns) => !own.some((o) => ns.startsWith(o + "/")));
        return roots.length === 1 ? roots[0] : undefined;
    };
    const folderKeyOf = (mod) => {
        const host = hostModuleOf(mod);
        const group = groupOfModule.get(mod) ?? (host ? groupOfModule.get(host) : undefined);
        if (group)
            return `grp:${group}`;
        if (!host)
            return undefined;
        const home = homeNamespaceOf(host);
        return home ? `ns:${home}` : `mod:${host}`;
    };
    const top = [];
    const byKey = new Map();
    const folder = (key) => {
        let f = byKey.get(key);
        if (!f)
            byKey.set(key, (f = { key, collections: [], children: [] }));
        return f;
    };
    for (const d of descriptors) {
        if (shouldFoldOutOfRecordTree(d))
            continue;
        const section = engine().descriptor.displayOf(d).nav?.section;
        if (typeof section === "string" && section.trim()) {
            folder(`grp:${section.trim()}`).collections.push(d);
            continue;
        }
        const ns = namespaceOf(d.name);
        if (ns) {
            folder(`ns:${ns}`).collections.push(d);
            continue;
        }
        const mod = foldModuleOf(d);
        const key = mod ? folderKeyOf(mod) : undefined;
        if (key) {
            folder(key).collections.push(d);
            continue;
        }
        top.push(d);
    }
    for (const key of [...byKey.keys()]) {
        if (!key.startsWith("ns:"))
            continue;
        for (let parent = namespaceOf(key.slice(3)); parent; parent = namespaceOf(parent))
            folder(`ns:${parent}`);
    }
    const homeOf = (d) => {
        const ns = namespaceOf(d.name);
        if (ns)
            return `ns:${ns}`;
        const owner = foldModuleOf(d);
        if (!owner)
            return undefined;
        const folded = folderKeyOf(owner);
        if (folded)
            return folded;
        const home = homeNamespaceOf(owner);
        return home ? `ns:${home}` : undefined;
    };
    const sectionParent = new Map();
    for (const [key, f] of [...byKey]) {
        if (!key.startsWith("grp:"))
            continue;
        const homes = new Set(f.collections.map(homeOf));
        const [home] = homes;
        if (homes.size !== 1 || !home)
            continue;
        if (home.startsWith("mod:") && byKey.has(home))
            sectionParent.set(key, home);
        else if (home.startsWith("ns:") && (byKey.has(home) || f.collections.some((d) => namespaceOf(d.name)))) {
            folder(home);
            for (let parent = namespaceOf(home.slice(3)); parent; parent = namespaceOf(parent))
                folder(`ns:${parent}`);
            sectionParent.set(key, home);
        }
    }
    const labelUnder = (key, parentKey) => groupLabel(key, titleOf, parentKey).trim().toLowerCase();
    const parentKeyOf = (key) => {
        const ns = key.startsWith("ns:") ? namespaceOf(key.slice(3)) : "";
        return ns ? `ns:${ns}` : undefined;
    };
    for (const [key, home] of [...sectionParent]) {
        if (labelUnder(key, home) !== labelUnder(home, parentKeyOf(home)))
            continue;
        byKey.get(home).collections.push(...byKey.get(key).collections);
        byKey.delete(key);
        sectionParent.delete(key);
    }
    const sorted = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
    const roots = [];
    for (const f of sorted) {
        const parent = f.key.startsWith("ns:") ? namespaceOf(f.key.slice(3)) : "";
        if (parent)
            byKey.get(`ns:${parent}`).children.push(f);
        else if (sectionParent.has(f.key))
            byKey.get(sectionParent.get(f.key)).children.push(f);
        else
            roots.push(f);
    }
    for (const f of byKey.values())
        f.children.sort(compareChildren);
    return { top, folders: foldSameLabel(roots, titleOf) };
}
export function compareChildren(a, b) {
    const sa = a.key.startsWith("grp:"), sb = b.key.startsWith("grp:");
    if (sa !== sb)
        return sa ? -1 : 1;
    if (sa) {
        const low = (f) => Math.min(Infinity, ...f.collections.map((d) => engine().descriptor.displayOf(d).nav?.order ?? Infinity));
        const d = low(a) - low(b);
        if (d !== 0 && !Number.isNaN(d))
            return d;
    }
    return a.key.localeCompare(b.key);
}
const FOLD_RANK = ["ns:", "mod:", "grp:"];
const foldRank = (key) => {
    const i = FOLD_RANK.findIndex((p) => key.startsWith(p));
    return i < 0 ? FOLD_RANK.length : i;
};
export function foldSameLabel(folders, titleOf, parentKey) {
    const labelOf = (f) => groupLabel(f.key, titleOf, parentKey).trim().toLowerCase();
    const byLabel = new Map();
    for (const f of folders)
        byLabel.set(labelOf(f), [...(byLabel.get(labelOf(f)) ?? []), f]);
    const out = [];
    for (const f of folders) {
        const [keep, ...rest] = [...byLabel.get(labelOf(f))].sort((a, b) => foldRank(a.key) - foldRank(b.key) || a.key.localeCompare(b.key));
        if (keep !== f)
            continue;
        const children = rest.length ? [...keep.children, ...rest.flatMap((r) => r.children)].sort(compareChildren) : keep.children;
        out.push({
            key: keep.key,
            collections: rest.length ? [...keep.collections, ...rest.flatMap((r) => r.collections)] : keep.collections,
            children: foldSameLabel(children, titleOf, keep.key),
        });
    }
    return out;
}
export const navKey = (e) => e.kind === "collection" ? e.descriptor.name : e.kind === "layers" ? e.label.toLowerCase() : e.folder.key.replace(/^(?:ns|mod|grp):/, "");
export function navHiddenOf(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw.filter((n) => typeof n === "string" && n.trim() !== "").map((n) => n.trim().toLowerCase());
}
export function withoutHidden(entries, hidden) {
    if (!hidden?.length)
        return entries;
    const names = new Set(hidden.map((n) => n.trim().toLowerCase()));
    return entries.filter((e) => !names.has(navKey(e).toLowerCase()));
}
export function orderTopLevel(top, folders, navOrder, layers) {
    const tail = !layers ? [] : Array.isArray(layers) ? layers : [layers];
    if (!navOrder?.length) {
        return [
            ...top.map((d) => ({ kind: "collection", descriptor: d })),
            ...folders.map((f) => ({ kind: "folder", folder: f })),
            ...tail,
        ];
    }
    const folderNames = new Set();
    const collect = (f) => {
        folderNames.add(navKey({ kind: "folder", folder: f }));
        f.children.forEach(collect);
    };
    folders.forEach(collect);
    for (const e of tail)
        folderNames.add(navKey(e));
    const named = new Set(navOrder.filter((n) => !folderNames.has(n)));
    const lifted = [];
    const prune = (f) => {
        const keep = [];
        for (const d of f.collections)
            (named.has(d.name) ? lifted : keep).push(d);
        const children = f.children.map(prune).filter((c) => c !== null);
        const untouched = keep.length === f.collections.length && children.length === f.children.length && children.every((c, i) => c === f.children[i]);
        if (untouched)
            return f;
        return keep.length || children.length ? { key: f.key, collections: keep, children } : null;
    };
    const remaining = folders.map(prune).filter((f) => f !== null);
    const entries = [
        ...top.map((d) => ({ kind: "collection", descriptor: d })),
        ...lifted.map((d) => ({ kind: "collection", descriptor: d })),
        ...remaining.map((f) => ({ kind: "folder", folder: f })),
        ...tail,
    ];
    const rank = new Map(navOrder.map((n, i) => [n, i]));
    return entries
        .map((e, i) => ({ e, i, r: rank.get(navKey(e)) ?? Number.POSITIVE_INFINITY }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(({ e }) => e);
}
export function groupLabel(key, titleOf, parentKey) {
    if (key.startsWith("ns:")) {
        const ns = key.slice(3);
        const authored = titleOf.get(ns);
        if (authored)
            return authored;
        const parent = parentKey?.startsWith("ns:") ? parentKey.slice(3) : "";
        return moduleLabel(parent && ns.startsWith(parent + "/") ? ns.slice(parent.length + 1) : ns);
    }
    const id = key.slice(4);
    return moduleLabel(id, titleOf.get(id));
}
export function moduleLabel(id, title) {
    if (title)
        return title;
    return id
        .split(/[_\-\s/]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
}
export const LAYERS_FOLDER_DEFAULT = "Layers";
export function layersFolderLabel(raw) {
    return typeof raw === "string" && raw.trim() ? raw.trim() : LAYERS_FOLDER_DEFAULT;
}
function keyMatches(pattern, key) {
    const re = pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${re}$`).test(key);
}
export function layerGroups(raw, keys) {
    if (!keys.length)
        return [];
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return [{ label: layersFolderLabel(raw), keys }];
    const groups = [];
    const rules = [];
    for (const [label, v] of Object.entries(raw)) {
        const patterns = (Array.isArray(v) ? v : [v]).filter((p) => typeof p === "string" && p.trim() !== "").map((p) => p.trim());
        if (!label.trim() || !patterns.length)
            continue;
        const group = { label: label.trim(), keys: [] };
        groups.push(group);
        rules.push({ group, patterns });
    }
    const rest = { label: LAYERS_FOLDER_DEFAULT, keys: [] };
    for (const k of keys)
        (rules.find((r) => r.patterns.some((p) => keyMatches(p, k)))?.group ?? rest).keys.push(k);
    return [...groups, rest].filter((g) => g.keys.length);
}
export function layerLabels(keys, titles) {
    const split = keys.map((k) => k.split("-"));
    let common = 0;
    if (keys.length > 1) {
        const shortest = Math.min(...split.map((s) => s.length));
        while (common < shortest - 1 && split.every((s) => s[common] === split[0][common]))
            common++;
    }
    const out = new Map();
    keys.forEach((k, i) => out.set(k, titles?.get(k) || moduleLabel(split[i].slice(common).join("-"))));
    return out;
}
export function layerRoute(d, layer) {
    const filter = { logic: "_and", rules: [{ field: "$source", operator: "_eq", value: layer }] };
    return `${routeFor(d)}?filter=${encodeURIComponent(JSON.stringify(filter))}`;
}
export function layerFolders(layers, descriptors, titles) {
    if (!layers.length)
        return [];
    const { titleOf, displayOf } = engine().descriptor;
    const labels = layerLabels(layers.map((l) => l.name), titles);
    const position = new Map(descriptors.map((d, i) => [d.name, i]));
    const byName = new Map(descriptors.map((d) => [d.name, d]));
    return layers
        .map((l) => {
        const rows = l.installed
            ? l.collections
                .filter((c) => c.count > 0 && byName.has(c.collection))
                .sort((a, b) => position.get(a.collection) - position.get(b.collection))
                .map((c) => {
                const d = byName.get(c.collection);
                return { collection: c.collection, title: titleOf(d), icon: displayOf(d).nav?.icon, count: c.count, route: layerRoute(d, l.name) };
            })
            : [];
        return { key: l.name, label: labels.get(l.name), installed: l.installed, rows };
    })
        .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
export function groupedLayerFolders(layers, descriptors, raw, titles) {
    return layerGroups(raw, layers.map((l) => l.name)).map((g) => ({
        label: g.label,
        layers: layerFolders(layers.filter((l) => g.keys.includes(l.name)), descriptors, titles),
    }));
}
export function layerNote(l) {
    if (!l.installed)
        return "not installed";
    return l.rows.length ? undefined : "no records yet";
}
export function layerEntries(rows, descriptors, nav) {
    const rowOf = new Map(rows.map((r) => [r.collection, r]));
    const held = descriptors.filter((d) => rowOf.has(d.name));
    const titleOf = nav.titleOf ?? new Map();
    const { top, folders } = groupTopLevel(held, nav.declared, nav.workspaceModule, nav.dependsOn, nav.navGroups, nav.namespacesOf, titleOf);
    const placed = new Set(top.map((d) => d.name));
    const walk = (f) => {
        f.collections.forEach((d) => placed.add(d.name));
        f.children.forEach(walk);
    };
    folders.forEach(walk);
    const position = new Map(held.map((d, i) => [d.name, i]));
    const rowsTop = [...top, ...held.filter((d) => !placed.has(d.name))].sort((a, b) => position.get(a.name) - position.get(b.name));
    const folderEntry = (f, parentKey) => ({
        kind: "folder",
        folder: f,
        label: groupLabel(f.key, titleOf, parentKey),
        entries: [
            ...f.collections.map((d) => ({ kind: "row", row: rowOf.get(d.name) })),
            ...f.children.map((c) => folderEntry(c, f.key)),
        ],
    });
    return orderTopLevel(rowsTop, folders, nav.navOrder).flatMap((e) => e.kind === "collection" ? [{ kind: "row", row: rowOf.get(e.descriptor.name) }] : e.kind === "folder" ? [folderEntry(e.folder)] : []);
}
// ── nav.yaml (cr-dt-008) ─────────────────────────────────────────────────────────────────────────────────────
// The left nav is a document the person arranges (nav.yaml at the workspace root, nav-doc.js). `buildTree` draws
// it by the design's rules; `legacyTree` is the grouping above (module folders, sections, navGroups/navOrder/
// navHidden), kept under one name for exactly two uses: the lossless migration of old settings into nav.yaml, and
// a workspace or layer that still has those settings and no nav.yaml.

/** The unplaced-row order: by title, then name. Passed to applyNavOp as its `collections`. */
export function tailOrder(descriptors, titleOf = (d) => d.title ?? d.name) {
    return new Set([...descriptors]
        .map((d) => ({ name: d.name, title: String(titleOf(d) ?? d.name) }))
        .sort((a, b) => a.title.localeCompare(b.title, "en") || a.name.localeCompare(b.name, "en"))
        .map((x) => x.name));
}
/** A node key: the kind's letter, then each path element URI-encoded and joined by "/" — a label `Sales/CRM` is
 *  `f/Sales%2FCRM`, never `f/Sales/CRM`. */
export const navPathKey = (letter, path) => `${letter}/${path.map((el) => encodeURIComponent(el)).join("/")}`;
const longestNamespace = (name, namespaces) => {
    let best = "";
    for (const ns of namespaces)
        if (name.startsWith(`${ns}/`) && ns.length > best.length)
            best = ns;
    return best;
};
/**
 * The tree nav.yaml describes, as nodes (design §3, rules 1-8). `doc` null draws the flat tree: every row by
 * title, then each namespace as a folder. Every folder, namespace and collection node carries `target`, the
 * NavTarget a host sends back in an op. No module marks and no module routes on folders.
 * @param {object} o
 * @param {Array<{ name: string }>} o.descriptors  the compiled collections
 * @param {object | null} o.doc  the NavDoc (normalised here)
 * @param {string[]} o.namespaces  the declared namespaces
 * @param {(d) => string} o.titleOf  a collection's title (the unplaced rows sort by it)
 * @param {Array} [o.views]  the workspace's ui-views; a collection's nav views draw under it (default node only)
 * @param {(ns: string, parentNs: string) => string} [o.namespaceTitle]  a namespace folder's label
 * @param {(d) => object} [o.nodeOf]  a collection's node (label, icon, route, count…); key and target are set here
 * @param {(name?: string) => string} [o.icon]  maps an authored icon name to the drawn one
 * @param {(d) => boolean} [o.internal]  a collection that stays out of the tree
 */
export function buildTree({ descriptors, doc, namespaces = [], titleOf = (d) => d.title ?? d.name, views = [], namespaceTitle, nodeOf, icon = (n) => n, internal = (d) => d.internal === true && !d.overlaid }) {
    const usable = descriptors.filter((d) => !internal(d));
    const byName = new Map(usable.map((d) => [d.name, d]));
    const tree = Array.isArray(doc?.tree) ? doc.tree : [];
    const hidden = new Set(Array.isArray(doc?.hidden) ? doc.hidden.filter((h) => typeof h === "string") : []);
    const nsTitle = namespaceTitle ?? ((ns, parent) => moduleLabel(parent && ns.startsWith(parent + "/") ? ns.slice(parent.length + 1) : ns));
    const parentNs = (ns) => longestNamespace(ns, namespaces.filter((n) => n !== ns));
    const collectionName = (e) => (typeof e === "string" ? e : e && typeof e === "object" && typeof e.collection === "string" ? e.collection : undefined);
    const isFolder = (e) => e && typeof e === "object" && typeof e.folder === "string";
    const isNamespace = (e) => e && typeof e === "object" && typeof e.namespace === "string";
    // the first occurrence of every name in document order: the one entry that draws it (rule 5). Held by POSITION
    // (the items array and the index in it), never by the entry: two plain-string entries `tasks` are equal, so an
    // identity test would let both draw
    const first = new Map();
    const placed = new Set(hidden);
    const isFirst = (id, items, i) => { const f = first.get(id); return f !== undefined && f.items === items && f.i === i; };
    const scan = (items) => {
        for (const [i, e] of (Array.isArray(items) ? items : []).entries()) {
            const c = collectionName(e);
            const id = c !== undefined ? `c:${c}` : isNamespace(e) ? `n:${e.namespace}` : undefined;
            if (id && !first.has(id))
                first.set(id, { items, i });
            if (c !== undefined)
                placed.add(c);
            if (isNamespace(e))
                placed.add(`ns:${e.namespace}`);
            if (isFolder(e) || isNamespace(e))
                scan(e.items);
        }
    };
    scan(tree);
    const order = [...tailOrder(usable, titleOf)];
    const used = new Map();
    const uniqueKey = (key) => {
        const n = (used.get(key) ?? 0) + 1;
        used.set(key, n);
        return n === 1 ? key : `${key}~${n}`;
    };
    const defaultNode = (d) => {
        const kids = navViewsOf(views, d.name).map((v) => {
            const r = viewRow(v);
            return { kind: "view", key: `v/${v.id}`, label: r.label, icon: icon(r.icon), ...(r.description ? { description: r.description } : {}), tooltip: r.tooltip, ...(v.route ? { route: v.route } : {}) };
        });
        return { kind: "collection", label: String(titleOf(d) ?? d.name), icon: icon(d.display?.nav?.icon), ...(kids.length ? { children: kids } : {}) };
    };
    const collectionNode = (d, entryIcon) => {
        const node = { ...(nodeOf ? nodeOf(d) : defaultNode(d)) };
        node.kind = "collection";
        node.key = uniqueKey(`c/${d.name}`);
        node.target = { name: d.name };
        if (entryIcon)
            node.icon = icon(entryIcon);
        return node;
    };
    const namespaceNode = (ns, path, entry) => {
        const p = [...path, `ns:${ns}`];
        return {
            kind: "namespace", key: uniqueKey(navPathKey("n", p)), label: nsTitle(ns, parentNs(ns)), icon: icon(entry?.icon ?? PLAIN_FOLDER_ICON), target: { name: ns },
            children: [...drawItems(entry?.items, p), ...tailsOf(ns, p)],
        };
    };
    /** What a level draws after its entries: its unplaced rows by title, then its unplaced namespaces by label. */
    const tailsOf = (ns, path) => {
        const rows = order.filter((n) => !placed.has(n) && longestNamespace(n, namespaces) === ns).map((n) => collectionNode(byName.get(n)));
        const nested = namespaces
            .filter((n) => !placed.has(`ns:${n}`) && !hidden.has(n) && parentNs(n) === ns)
            .map((n) => ({ n, label: nsTitle(n, parentNs(n)) }))
            .sort((a, b) => a.label.localeCompare(b.label, "en") || a.n.localeCompare(b.n, "en"))
            .map(({ n }) => namespaceNode(n, path));
        return [...rows, ...nested];
    };
    function drawItems(items, path) {
        const out = [];
        for (const [i, e] of (Array.isArray(items) ? items : []).entries()) {
            const c = collectionName(e);
            if (c !== undefined) {
                if (!isFirst(`c:${c}`, items, i) || hidden.has(c) || !byName.has(c))
                    continue;
                out.push(collectionNode(byName.get(c), typeof e === "object" ? e.icon : undefined));
            }
            else if (isFolder(e)) {
                if (e.hidden === true)
                    continue;
                const p = [...path, e.folder];
                out.push({ kind: "folder", key: uniqueKey(navPathKey("f", p)), label: e.folder, icon: icon(e.icon ?? PLAIN_FOLDER_ICON), target: { folder: p }, children: drawItems(e.items, p) });
            }
            else if (isNamespace(e)) {
                if (!isFirst(`n:${e.namespace}`, items, i) || e.hidden === true || hidden.has(e.namespace))
                    continue;
                out.push(namespaceNode(e.namespace, path, e));
            }
        }
        return out;
    }
    return [...drawItems(tree, []), ...tailsOf("", [])];
}
/**
 * A record layer's tree when its clone holds nav.yaml (design §3 rule 9): buildTree's rules over the rows the layer
 * holds and nothing else. A name the layer does not hold is skipped, a declared namespace it holds no row of draws no
 * folder, and every collection node carries its layer `row` ({ collection, title, icon, count, route }). Keys and
 * targets are buildTree's; the host prefixes the keys with the layer. A layer with no nav.yaml draws `layerEntries`.
 * @param {{ rows: Array<{ collection: string }>, descriptors: Array<{ name: string }>, doc: object | null, namespaces?: string[], titleOf?: (d) => string, namespaceTitle?: (ns: string, parentNs: string) => string, icon?: (name?: string) => string }} o
 */
export function layerTree({ rows, descriptors, doc, namespaces = [], titleOf, namespaceTitle, icon }) {
    const rowOf = new Map(rows.map((r) => [r.collection, r]));
    const held = descriptors.filter((d) => rowOf.has(d.name));
    return buildTree({
        descriptors: held, doc, titleOf, namespaceTitle, icon,
        namespaces: namespaces.filter((ns) => held.some((d) => d.name.startsWith(`${ns}/`))),
        // a layer's rows are the records it holds, already chosen; nothing it holds is folded out
        internal: () => false,
        nodeOf: (d) => ({ row: rowOf.get(d.name) }),
    });
}
/** `dreamteamer.navGroups` as a Map — module ids per group label; anything else is empty. */
export function navGroupsOf(raw) {
    const out = new Map();
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return out;
    for (const [key, ids] of Object.entries(raw))
        if (Array.isArray(ids))
            out.set(key, ids.filter((i) => typeof i === "string"));
    return out;
}
/** `dreamteamer.navOrder` as a list of names. */
export const navOrderOf = (raw) => (Array.isArray(raw) ? raw.filter((n) => typeof n === "string") : []);
/** Whether any of the three old nav settings holds something (an empty array or object counts as unset). */
export function hasNavSettings(settings) {
    const set = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v).length > 0 : false);
    return Boolean(settings) && (set(settings.navGroups) || set(settings.navOrder) || set(settings.navHidden));
}
/**
 * The tree the old settings drew: groupTopLevel → orderTopLevel → withoutHidden, unchanged.
 * @param {Array} descriptors
 * @param {{ navGroups?: unknown, navOrder?: unknown, navHidden?: unknown }} settings
 * @param {{ declared?: string[], workspaceModule?: string, dependsOn?: Map, namespacesOf?: Map, titleOf?: Map, layers?: unknown }} ctx
 */
export function legacyTree(descriptors, settings = {}, ctx = {}) {
    const { top, folders } = groupTopLevel(descriptors, ctx.declared ?? [], ctx.workspaceModule, ctx.dependsOn, navGroupsOf(settings?.navGroups), ctx.namespacesOf, ctx.titleOf ?? new Map());
    return withoutHidden(orderTopLevel(top, folders, navOrderOf(settings?.navOrder), ctx.layers), navHiddenOf(settings?.navHidden));
}
/** The icon a legacy folder draws (an authored name, before codiconFor): its module's look — the first shipped
 *  collection's icon by nav order — else the module icon; undefined for a folder no module owns (a plain folder). */
export function legacyFolderIcon(folder, modules, byName) {
    const module = folderModule(folder, modules);
    if (!module)
        return undefined;
    const { displayOf } = engine().descriptor;
    return moduleIcon(modules.find((m) => m.id === module), (c) => {
        const d = byName.get(c);
        return d ? { icon: displayOf(d).nav?.icon, order: displayOf(d).nav?.order, runtime: isRuntime(d) } : undefined;
    }) ?? MODULE_ICON;
}
/** What `legacyTree` and `legacyDoc` need of a workspace, read from its compiled runtime: the declared namespaces,
 *  its own module, the module graph, module titles, and each legacy folder's icon. */
export function legacyContext(root) {
    const modules = loadModules(root);
    const byName = new Map(loadDescriptors(root).map((d) => [d.name, d]));
    return {
        declared: engine().namespaces,
        workspaceModule: workspaceModule(root),
        dependsOn: moduleDependencies(root),
        namespacesOf: moduleNamespaces(root),
        titleOf: new Map(modules.map((m) => [m.id, m.title])),
        iconOf: (folder) => legacyFolderIcon(folder, modules, byName),
    };
}
