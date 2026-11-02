// Route → tab title. An app tab is titled by the CONTENT it shows, not by the extension
// ("tasks", "Dana Oren", "Data Model") — operator 2026-07-27: "content opened should be
// properly titled on the tab". The dt icon on the tab already says whose surface it is, so
// the title carries no prefix.
import * as fs from "node:fs";
import * as path from "node:path";
import { EXT, collectionDir, loadDescriptors, loadUiViews, parseRecord, systemDir, titleField, uiViewFile, recordFileFor, viewLabel } from "./fsdata.js";
import { engine } from "./engine.js";
/**
 * Identity of a route for tab de-duplication: the path, plus its `filter` — the rest of the query (a
 * layout tweak, a search, a field picked) doesn't count. ⚠ The filter does, because it is what makes
 * two nav rows different places: each record-layer row opens `/content/<c>?filter=<$source is it>`,
 * and with the path alone a click on the second layer's row found the first layer's tab already
 * "showing" it and only revealed it, so the browse never changed (operator 2026-10-29).
 */
export function routeKey(route) {
    const query = new URLSearchParams(route.split("#")[0].split("?")[1] ?? "");
    // the two query keys that make a different PLACE: a filter (each layer's row), and the module the
    // Schema tab is narrowed to (each module's Activity) — clicking another project's row must land
    // on that project, not reveal the tab already narrowed to the first (operator 2026-10-29)
    const place = ["filter", "module"].filter((k) => query.get(k)).map((k) => `${k}=${encodeURIComponent(query.get(k))}`);
    const bare = routePath(route);
    return place.length ? `${bare}?${place.join("&")}` : bare;
}
/** The PATH of a route, no query, no trailing slash — what a tab is titled by and a reveal resolves.
 *  Not `routeKey`: a filter makes a tab its own place, but it is never part of the tab's name. */
export function routePath(route) {
    const head = route.split(/[?#]/)[0];
    return head.length > 1 && head.endsWith("/") ? head.slice(0, -1) : head;
}
/** Longest registered collection name that prefixes `rest`, then whatever's left is the record id.
 *  Mirrors the webview's `resolveContentPath` — collection ids may themselves contain '/'. */
function splitContent(rest, descriptors) {
    const segments = rest.split("/").filter(Boolean);
    for (let take = segments.length; take >= 1; take--) {
        const candidate = segments.slice(0, take).join("/");
        const d = descriptors.find((x) => x.name === candidate);
        if (!d)
            continue;
        const id = segments.slice(take).join("/");
        return { d, id: id || undefined };
    }
    return {};
}
/** The file a record id maps to — computed for conventional storage, so titling never parses a
 *  collection; probed per parent folder for a collection stored under another (fsdata.recordFileFor). */
export function recordFile(root, d, id) {
    return recordFileFor(root, d, id);
}
/**
 * A `/settings/schema/<kind>[/<id>]` tail → the file or folder it stands for in the compiled runtime.
 *
 * The runtime is where the surface actually READ the record from, it always exists, and it is one
 * rule for every kind — the same call reveal.ts already makes for a system-stored row. The SOURCE
 * under the owning module is a different question, and the engine answers it (`sourceHint`).
 */
function schemaFile(root, tail) {
    const exists = (f) => (fs.existsSync(f) ? f : undefined);
    const segments = tail.split("/").filter(Boolean);
    const kind = segments[0];
    if (!kind)
        return exists(systemDir(root, "collections"));
    const dir = systemDir(root, kind);
    const id = segments.slice(1).join("/");
    if (!id)
        return exists(dir);
    // The record files of a runtime kind are `<id>.<suffix>.yaml`, and the suffix is the kind's
    // singular — which the descriptor knows. Ask it rather than guessing.
    const d = loadDescriptors(root).find((x) => x.name === kind);
    const storage = d ? engine().descriptor.storageOf(d) : undefined;
    if (!storage?.suffix)
        return exists(dir);
    return exists(path.join(dir, `${id}.${storage.suffix}${EXT[storage.format] ?? ""}`));
}
/** Route → the place on disk it shows, for the reveal gestures (reveal.ts). Same grammar as
 *  `titleForRoute`, so a tab that titles itself "Dana Oren" reveals Dana Oren's file. Returns a
 *  FOLDER for collection-level routes, a FILE for a record, and undefined for a route with no
 *  place on disk (a new-record form, an unknown collection). */
export function fileForRoute(root, route) {
    const p = routePath(route);
    const exists = (f) => (fs.existsSync(f) ? f : undefined);
    // THE SCHEMA TAB. `/settings/schema/<kind>[/<id>]` — the kind is one segment (identity entities
    // stay flat), the id is everything after it (a collection name carries a namespace slash).
    if (p === "/settings/schema")
        return exists(systemDir(root, "collections"));
    if (p.startsWith("/settings/schema/"))
        return schemaFile(root, p.slice("/settings/schema/".length));
    // ⚠ KEPT, not replaced. `/settings/data-model*` redirects into the tab at RUNTIME, but a tab
    // restored from the previous session titles and reveals itself from its persisted route before the
    // app has booted far enough to redirect anything.
    if (p === "/settings/data-model")
        return exists(systemDir(root, "collections"));
    if (p.startsWith("/settings/data-model/"))
        return schemaFile(root, `collections/${p.slice("/settings/data-model/".length)}`);
    for (const prefix of ["/content/", "/settings/system/"]) {
        if (!p.startsWith(prefix))
            continue;
        const rest = p.slice(prefix.length);
        if (!rest)
            return undefined;
        const { d, id } = splitContent(rest, loadDescriptors(root));
        if (!d)
            return undefined;
        // '+' is a form for a record that doesn't exist yet — the folder it will land in is the
        // closest honest answer.
        if (!id || id === "+")
            return exists(collectionDir(root, d));
        return recordFile(root, d, id);
    }
    const view = loadUiViews(root).find((v) => routePath(v.route) === p);
    return view ? exists(uiViewFile(root, view)) : undefined;
}
/**
 * Editor tabs are a fixed-width strip; a record whose title field is a whole sentence rather than
 * a short label pushed every other tab off the
 * bar (operator 2026-07-29: "long titles should be clipped like in vscode"). VS Code clips a FILE
 * tab because a filename is short and the label is elided against available width; a webview
 * panel just wears whatever string it is given, and `WebviewPanel` exposes no tooltip to recover
 * the rest — so the clip happens here, at the source, and the full value stays readable in the
 * page header (which shows it complete, ellipsised with a `title` tooltip).
 *
 * Cut on a word boundary when there is one near the limit, so the label reads as a phrase rather
 * than as a severed word.
 */
const MAX_TAB_TITLE = 34;
function clipTitle(title) {
    if (title.length <= MAX_TAB_TITLE)
        return title;
    const head = title.slice(0, MAX_TAB_TITLE);
    const space = head.lastIndexOf(" ");
    return `${(space > MAX_TAB_TITLE * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}
export function titleForRoute(root, route) {
    return clipTitle(fullTitleForRoute(root, route));
}
function fullTitleForRoute(root, route) {
    const p = routePath(route);
    if (p === "/settings/schema")
        return "Schema";
    if (p.startsWith("/settings/schema/")) {
        const tail = p.slice("/settings/schema/".length);
        const segments = tail.split("/").filter(Boolean);
        const kind = segments[0] ?? "";
        const id = segments.slice(1).join("/");
        // A collection's designer keeps titling itself `<name> schema` — the words the operator uses
        // for that pane, and the title the data-model detail page has always worn.
        if (kind === "collections")
            return id ? `${id} schema` : "Schema";
        // the two rail rows that are pages, not collections (SchemaTab.vue PAGE_KINDS)
        if (!id && kind === "activity")
            return "Activity";
        if (!id && kind === "sources")
            return "Sources";
        if (!id)
            return titleOfKind(root, kind);
        return id.split("/").pop();
    }
    // ⚠ KEPT for a restored tab, exactly as in `fileForRoute` above.
    if (p === "/settings/data-model")
        return "Data Model";
    if (p.startsWith("/settings/data-model/"))
        return `${p.slice("/settings/data-model/".length)} schema`;
    for (const prefix of ["/content/", "/settings/system/"]) {
        if (!p.startsWith(prefix))
            continue;
        const rest = p.slice(prefix.length);
        if (!rest)
            return "dreamteamer";
        const { d, id } = splitContent(rest, loadDescriptors(root));
        if (!d)
            return rest.split("/").pop() || "dreamteamer";
        if (!id)
            return d.name;
        if (id === "+")
            return `new ${d.name}`;
        return fullRecordTitle(root, d, id);
    }
    // a ui-view page (inbox, a saved view) titles itself with its nav title
    const view = loadUiViews(root).find((v) => routePath(v.route) === p);
    if (view)
        return viewLabel(view);
    return "dreamteamer";
}
function fullRecordTitle(root, d, id) {
    const file = recordFile(root, d, id);
    const tf = file ? titleField(d) : undefined;
    const value = tf ? parseRecord(file, d)[tf] : undefined;
    return typeof value === "string" && value.trim() ? value.trim() : id.split("/").pop();
}
/**
 * A record's title as `titleForRoute` gives it for `/content/<collection>/<id>`, for a caller that
 * already holds the descriptor. ⚠ The route form re-reads every descriptor to find it, which is
 * nothing for one tab and was ~15 s of a 17 s Activity page that titles every record its commits
 * touched (measured 2026-10-31 on a workspace with sixteen layers).
 */
export function recordTitle(root, d, id) {
    return clipTitle(fullRecordTitle(root, d, id));
}
/** A runtime kind's own resolved title (`ui-views` → "Ui Views" unless the descriptor says otherwise).
 *  Compile resolved it; the tab never title-cases an id itself. */
function titleOfKind(root, kind) {
    const d = loadDescriptors(root).find((x) => x.name === kind);
    return d ? engine().descriptor.titleOf(d) : kind;
}
