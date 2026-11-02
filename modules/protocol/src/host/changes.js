// WHAT KIND OF CHANGE JUST LANDED ON DISK — the one bit the app tabs need and the host alone knows.
//
// The file watcher covers `{data,state,.dreamteamer}/**`, and every hit used to be told to the app
// tabs the same way: one `dt:invalidate` with no argument. That was fine while exactly one thing
// listened (the ui-view table), and stops being fine the moment the SCHEMA caches listen too — a
// plain `dt set` on one record would then refetch `/presentation`, every collection's fields and the
// relations table, on every keystroke an agent makes.
//
// So the host classifies, because only the host sees the path. `.dreamteamer/` is the COMPILED
// RUNTIME: nothing writes there but a compile, so a hit is a schema change and nothing else. `data/`
// and `state/` are records.
//
// ⚠ Match on the path SEGMENT, not a prefix string. `data/` and `database-notes/` share five
// characters, and `.dreamteamer/` is a hidden directory whose name is a prefix of nothing but is
// also, spelled without the dot, the name of a module folder in this very tree.
/** `schema` outranks `data`: a debounce window that saw both must refresh both. */
export function strongerScope(a, b) {
    return a === "schema" || b === "schema" ? "schema" : "data";
}
/**
 * Which bucket a changed file falls in, given the workspace root and the file's absolute path.
 * Anything outside the watched roots reads as `data` — the conservative answer, since `data` is the
 * cheap refresh and an unrecognised path is not evidence that the schema moved.
 */
export function changeScope(root, file) {
    const rel = relativeSegments(root, file);
    if (rel[0] !== RUNTIME_DIR)
        return "data";
    // ⚠ NOT EVERYTHING IN THE RUNTIME IS COMPILED OUTPUT. `store.js` takes `.dreamteamer/.write-lock`
    // around EVERY record write and deletes it again, so a plain `dt add` fires two events in the
    // runtime and read as a compile — measured 2026-08-29, and it turned the schema refresh into a
    // full `/presentation` refetch on every record an agent writes. Compile output is `manifest.yaml`
    // plus the KINDS directories, none of which start with a dot; the transient bookkeeping does.
    return rel.slice(1).some(isDotEntry) ? "data" : "schema";
}
/** The compiled runtime's directory name — `runtimeDir()` on the engine side. */
const RUNTIME_DIR = ".dreamteamer";
/**
 * What the in-workspace watcher listens to, from the workspace root. `data/`, `state/` and the
 * compiled runtime are the workspace's own; `git_modules/` and `modules/` are there because a
 * collection's records need not be in `data/` (engine 0.35.0): a module-owned collection keeps them in
 * the module's folder and a record layer in another workspace's clone, both under those two. A CLI
 * write there used to leave the tree stale until something under `data/` moved.
 */
export const RECORD_WATCH_GLOB = "{data,state,.dreamteamer,git_modules,modules}/**";
/** The folders whose every change is the workspace's own: records and the compiled runtime. */
const ALWAYS_WATCHED = new Set(["data", "state", RUNTIME_DIR]);
/**
 * Does a change the watcher saw concern this workspace? Always under `data/`, `state/` and the
 * runtime; under `git_modules/` and `modules/` only when `underRecordRoot` says the file sits in some
 * collection's record root — most of those trees are module SOURCES and a clone's `.git`, and a
 * `git fetch` in a module must not refresh every open tab.
 */
export function isWatchedChange(root, file, underRecordRoot) {
    const rel = relativeSegments(root, file);
    if (!rel.length)
        return false;
    if (ALWAYS_WATCHED.has(rel[0]))
        return true;
    return underRecordRoot(file);
}
/** `.write-lock`, and anything else the engine parks in the runtime that compile did not emit. */
function isDotEntry(segment) {
    return segment.startsWith(".");
}
/** Split `file` into path segments relative to `root`. `[]` when it is not under `root`. */
function relativeSegments(root, file) {
    const r = normalize(root);
    const f = normalize(file);
    if (f === r)
        return [];
    if (!f.startsWith(r + "/"))
        return [];
    return f.slice(r.length + 1).split("/").filter(Boolean);
}
/** Windows separators and trailing slashes, off. Not a path.resolve: these are already absolute. */
function normalize(p) {
    return p.replace(/\\/g, "/").replace(/\/+$/, "");
}
