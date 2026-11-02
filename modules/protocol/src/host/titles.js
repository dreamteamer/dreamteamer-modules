// Ported from the dreamteamer VS Code extension's host side (src/titles.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import { EXT, collectionDir, loadDescriptors, loadUiViews, parseRecord, systemDir, titleField, uiViewFile, recordFileFor, viewLabel } from "./fsdata.js";
import { engine } from "./engine.js";
export function routeKey(route) {
    const query = new URLSearchParams(route.split("#")[0].split("?")[1] ?? "");
    const place = ["filter", "module"].filter((k) => query.get(k)).map((k) => `${k}=${encodeURIComponent(query.get(k))}`);
    const bare = routePath(route);
    return place.length ? `${bare}?${place.join("&")}` : bare;
}
export function routePath(route) {
    const head = route.split(/[?#]/)[0];
    return head.length > 1 && head.endsWith("/") ? head.slice(0, -1) : head;
}
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
export function recordFile(root, d, id) {
    return recordFileFor(root, d, id);
}
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
    const d = loadDescriptors(root).find((x) => x.name === kind);
    const storage = d ? engine().descriptor.storageOf(d) : undefined;
    if (!storage?.suffix)
        return exists(dir);
    return exists(path.join(dir, `${id}.${storage.suffix}${EXT[storage.format] ?? ""}`));
}
export function fileForRoute(root, route) {
    const p = routePath(route);
    const exists = (f) => (fs.existsSync(f) ? f : undefined);
    if (p === "/settings/schema")
        return exists(systemDir(root, "collections"));
    if (p.startsWith("/settings/schema/"))
        return schemaFile(root, p.slice("/settings/schema/".length));
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
        if (!id || id === "+")
            return exists(collectionDir(root, d));
        return recordFile(root, d, id);
    }
    const view = loadUiViews(root).find((v) => routePath(v.route) === p);
    return view ? exists(uiViewFile(root, view)) : undefined;
}
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
        if (kind === "collections")
            return id ? `${id} schema` : "Schema";
        if (!id && kind === "activity")
            return "Activity";
        if (!id && kind === "sources")
            return "Sources";
        if (!id)
            return titleOfKind(root, kind);
        return id.split("/").pop();
    }
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
export function recordTitle(root, d, id) {
    return clipTitle(fullRecordTitle(root, d, id));
}
function titleOfKind(root, kind) {
    const d = loadDescriptors(root).find((x) => x.name === kind);
    return d ? engine().descriptor.titleOf(d) : kind;
}
