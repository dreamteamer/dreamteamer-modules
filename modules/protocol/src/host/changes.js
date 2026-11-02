// Ported from the dreamteamer VS Code extension's host side (src/changes.ts); PROTOCOL.md is the contract it answers.
export function strongerScope(a, b) {
    return a === "schema" || b === "schema" ? "schema" : "data";
}
export function changeScope(root, file) {
    const rel = relativeSegments(root, file);
    if (rel[0] !== RUNTIME_DIR)
        return "data";
    return rel.slice(1).some(isDotEntry) ? "data" : "schema";
}
const RUNTIME_DIR = ".dreamteamer";
export const RECORD_WATCH_GLOB = "{data,state,.dreamteamer,git_modules,modules}/**";
const ALWAYS_WATCHED = new Set(["data", "state", RUNTIME_DIR]);
export function isWatchedChange(root, file, underRecordRoot) {
    const rel = relativeSegments(root, file);
    if (!rel.length)
        return false;
    if (ALWAYS_WATCHED.has(rel[0]))
        return true;
    return underRecordRoot(file);
}
function isDotEntry(segment) {
    return segment.startsWith(".");
}
function relativeSegments(root, file) {
    const r = normalize(root);
    const f = normalize(file);
    if (f === r)
        return [];
    if (!f.startsWith(r + "/"))
        return [];
    return f.slice(r.length + 1).split("/").filter(Boolean);
}
function normalize(p) {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
}
export function invalidateMessage(scope, opts = {}) {
    return opts.pages ? { type: "dt:invalidate", scope, pages: true } : { type: "dt:invalidate", scope };
}
