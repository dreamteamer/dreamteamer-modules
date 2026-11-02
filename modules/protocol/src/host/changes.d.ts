export type ChangeScope = "schema" | "data";
/** `schema` outranks `data`: a debounce window that saw both must refresh both. */
export declare function strongerScope(a: ChangeScope | undefined, b: ChangeScope | undefined): ChangeScope;
/**
 * Which bucket a changed file falls in, given the workspace root and the file's absolute path.
 * Anything outside the watched roots reads as `data` — the conservative answer, since `data` is the
 * cheap refresh and an unrecognised path is not evidence that the schema moved.
 */
export declare function changeScope(root: string, file: string): ChangeScope;
/**
 * What the in-workspace watcher listens to, from the workspace root. `data/`, `state/` and the
 * compiled runtime are the workspace's own; `git_modules/` and `modules/` are there because a
 * collection's records need not be in `data/` (engine 0.35.0): a module-owned collection keeps them in
 * the module's folder and a record layer in another workspace's clone, both under those two. A CLI
 * write there used to leave the tree stale until something under `data/` moved.
 */
export declare const RECORD_WATCH_GLOB = "{data,state,.dreamteamer,git_modules,modules}/**";
/**
 * Does a change the watcher saw concern this workspace? Always under `data/`, `state/` and the
 * runtime; under `git_modules/` and `modules/` only when `underRecordRoot` says the file sits in some
 * collection's record root — most of those trees are module SOURCES and a clone's `.git`, and a
 * `git fetch` in a module must not refresh every open tab.
 */
export declare function isWatchedChange(root: string, file: string, underRecordRoot: (file: string) => boolean): boolean;
