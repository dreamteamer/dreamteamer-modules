export declare const EXT: Record<string, string>;
/**
 * A COMPILED collection descriptor (descriptor format v2, engine 0.33.0): the authored keys plus the
 * `compiled` block compile wrote. Indexed loosely ON PURPOSE — this file does not describe the shape,
 * because nothing in this extension may read it. ⚠ ASK THE ENGINE: `engine().descriptor.storageOf`,
 * `isRuntime`, `isInternal`, `moduleOf`, `overlaidByOf`, `displayOf`, `fieldsOf`, … are the one reader
 * of a compiled descriptor, and the answer to "which of the authored keys and `compiled.defaults`
 * says what the storage path is" belongs to it. `name` is the one key read directly: it is the key
 * the engine's own loader indexes by.
 */
export interface Descriptor {
    name: string;
    [key: string]: any;
}
/** A view's (and a collection's) `display` block — the four sub-blocks a ui-view may carry. */
export interface ViewDisplay {
    /** A view with no `nav` has no nav entry. */
    nav?: {
        title?: string;
        icon?: string;
        order?: number;
    };
    list?: {
        layout?: string;
        columns?: string[];
        sort?: string;
        options?: Record<string, any>;
    };
    record?: {
        layout?: string;
        subtitle?: string;
        badge?: string;
        color_by?: string;
        options?: Record<string, any>;
    };
    form?: {
        sections?: Array<{
            title: string;
            fields: string[];
        }>;
    };
}
/**
 * One ui-view record, in the v2 vocabulary (design §3.5, §4.1): a NAMED variant of a collection's
 * default view — the default is the collection's own `display`, never a view. `display` is what the
 * view changes; `compiled.display` is compile's merge of it over its collection's, which is what a
 * surface draws.
 */
export interface UiView {
    /** The record id — its filename, derived from the route. */
    id: string;
    name?: string;
    title?: string;
    description?: string;
    /** The path the view renders at. */
    route: string;
    /** One record, a collection's rows, or a standalone page. */
    scope: "record" | "collection" | "page";
    /** `collections/<name>`; a page may omit it. */
    collection?: string;
    filter?: Record<string, any>;
    display?: ViewDisplay;
    compiled?: {
        display?: ViewDisplay;
    };
}
/** The display a view DRAWS — compile's merge over its collection's, else what it authored. */
export declare function viewDisplay(v: UiView): ViewDisplay;
/** What a view is called wherever it is listed: its nav title, else its own title, else its id. */
export declare function viewLabel(v: UiView): string;
/**
 * A collection's NAMED views as the nav lists them under it: the collection-scope views of that
 * collection that carry a `display.nav` — the engine's rule, "a view with no `nav` has no nav
 * entry". There is no default to exclude: a collection's default view is its own `display`, and
 * the collection row already opens it.
 */
export declare function navViewsOf(views: UiView[], collection: string): UiView[];
/** How a view row reads in the tree: its label, its icon, and its layout when that is not a table. */
export declare function viewRow(v: UiView): {
    label: string;
    icon: string;
    description?: string;
    tooltip: string;
};
/** The bare collection a view is of (`collections/` dropped), or `""` for a page. */
export declare function viewCollection(v: UiView): string;
export interface RecordEntry {
    id: string;
    file: string;
    fields: Record<string, any>;
}
export declare function findWorkspaceRoot(folders: readonly {
    fsPath: string;
}[]): string | undefined;
/**
 * Are this collection's records the COMPILED runtime's build output (`compiled.runtime`)? Runtime-stored
 * records (collections, skills, agents, ui-views…) are generated, gitignored and not writable through
 * the store — they are edited as sources and recompiled. Getting this wrong in the false direction
 * offers a write gesture on a compiled artifact.
 *
 * ⚠ A STORAGE question — it decides HOW A WRITE IS PERFORMED. Where a collection is DRAWN is
 * `isInternal`, and the two are orthogonal (design §3.3): `repos` is internal and not runtime.
 */
export declare function isRuntime(d: Descriptor): boolean;
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
export declare function isInternal(d: Descriptor): boolean;
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
export declare function systemDir(root: string, kind: string): string;
/** A compiled module record — the projection compile writes from each module's package.json. */
export interface ModuleRecord {
    id: string;
    name: string;
    title?: string;
    channel?: string;
    path?: string;
    /** Where the module's sources live, as compile stamped it: `modules` · `git_modules` ·
     *  `node_modules` · `root`. A write into an npm-shaped one is erased by the next install. */
    location?: string;
    /** The modules this one declares a HARD dependency on, as `modules/<id>` refs — compile's copy of
     *  the authored `dreamteamer.dependencies`, and the same list the extends gate charges an overlay
     *  for. Absent on a module that declares none, and on a runtime compiled by an engine that predates
     *  the field — which is why the nav rule that reads it (`groupTopLevel`) is off without it. */
    dependencies?: string[];
    /** The namespaces the module declares (`dreamteamer.namespaces`) — which module a namespace folder
     *  in the nav belongs to. */
    namespaces?: string[];
    /** The collections the module ships, as `collections/<name>` refs — what makes a nav section that
     *  holds exactly these the module's own folder (`nav.ts` folderModule). */
    collections?: string[];
}
/** module id → the modules it declares a hard dependency on, for the nav's one-hop fold (`nav.ts`).
 *  Empty on a runtime whose module records carry no `dependencies`, which turns the rule off rather
 *  than guessing at a graph. */
export declare function moduleDependencies(root: string): Map<string, string[]>;
/** module id → the namespaces it declares, for the nav's one-module-one-folder fold (`nav.ts`): a
 *  module that declares a namespace files its default-namespace collections in that namespace's folder
 *  rather than a module folder beside it. Empty when no module record carries `namespaces`. */
export declare function moduleNamespaces(root: string): Map<string, string[]>;
/** The modules this workspace compiled — their titles label the nav's folders, their
 *  `dependencies` drive its one-hop fold. Empty before the first compile. */
export declare function loadModules(root: string): ModuleRecord[];
/** The module the workspace's OWN sources live in — `dreamteamer.workspace_module` in the root
 *  `package.json` (design §4.4), the ONLY place it is declared (the compiled manifest does not carry
 *  it). Undefined when nothing declares it or the file cannot be read, and the nav's module fold is
 *  OFF in that case (`groupTopLevel`): without knowing which module is the operator's own catch-all,
 *  folding by module would put their whole vault under one folder named after itself. */
export declare function workspaceModule(root: string): string | undefined;
/**
 * The workspace's own NAME — the root `package.json` `name`, the word a record read from the write root
 * is sourced to (the extension's `$source`, 0.24.0). The folder's basename when the package names none,
 * so a source is never the empty string.
 */
export declare function workspaceName(root: string): string;
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
export declare function loadDescriptors(root: string): Descriptor[];
/** One folder a collection's records are read from, and the git repo that holds it. */
export interface CollectionRoot {
    /** Absolute. */
    dir: string;
    /** The repo, workspace-relative (`.` is the workspace itself) — where git is asked about this root. */
    repo: string;
    /** The record layer this root comes from; absent for the write root. */
    layer?: string;
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
export declare function collectionRoots(root: string, d: Descriptor): CollectionRoot[];
/** A collection's own records root — the WRITE root, where a new record lands. Every root a record can
 *  be READ from is `collectionRoots`. */
export declare function collectionDir(root: string, d: Descriptor): string;
/**
 * The git repo holding `abs` (a file or a folder), workspace-relative: the repo of the LONGEST
 * collection root that contains it, across every root of every collection — the same longest-root
 * rule `fileToRecord` and the engine's `pathToRecord` use. `.` when no root claims it.
 */
export declare function repoOfPath(root: string, descriptors: Iterable<Descriptor>, abs: string): string;
/**
 * Is `abs` inside a record root of some collection? The record watcher covers `data/`, `state/` and
 * `.dreamteamer/` outright; a module-owned collection or a record layer keeps its records elsewhere
 * (`git_modules/<m>/data/…`, `modules/<m>/data/…`), where most files — sources, a clone's `.git` —
 * are NOT records. A change there refreshes the tree only when this says so.
 */
export declare function isUnderRecordRoot(root: string, descriptors: Iterable<Descriptor>, abs: string): boolean;
export declare function parseRecordText(text: string, d: Descriptor, bodyField?: string): Record<string, any>;
export declare function serializeRecord(d: Descriptor, fields: Record<string, any>): string;
export declare function bodyFieldOf(d: Descriptor): string | undefined;
export declare function parseRecord(file: string, d: Descriptor): Record<string, any>;
export declare function fileToRecord(root: string, descriptors: Descriptor[], fsPath: string): {
    d: Descriptor;
    id: string;
} | undefined;
/**
 * Every folder a record of `d` can sit in: its own root, then — for a collection stored under
 * another — the child folder inside each parent record's folder, in parent-id order, then each record
 * layer's folder (engine 0.35.0). The id of a record is its path inside WHICHEVER of these it is in,
 * which is what keeps it independent of placement. `descriptors` is looked up when the caller has
 * none; the parent's root is in it. Compile refuses a layer on a placed collection, so the two never
 * meet: a placed collection's list ends at its parents' folders.
 */
export declare function recordRoots(root: string, d: Descriptor, descriptors?: Descriptor[]): string[];
/**
 * The file a record id names, or undefined. Computed for conventional storage — titling must never
 * parse a collection — and PROBED for a placed one: the id does not say which parent folder holds
 * it, so each candidate root is tried, which is one `existsSync` per parent and no walk.
 */
export declare function recordFileFor(root: string, d: Descriptor, id: string, descriptors?: Descriptor[]): string | undefined;
export declare function listRecords(root: string, d: Descriptor): RecordEntry[];
/**
 * id → file for the records of `d` under ONE root, in walk order, WITHOUT parsing a record — the walk
 * `listRoot` builds on and what a count or a duplicate check needs: a source's record count must not
 * cost a parse per record on every presentation read.
 */
export declare function walkIds(dir: string, d: Descriptor): Map<string, string>;
/**
 * The ids MORE THAN ONE root of `d` holds, each with the roots holding it in the engine's order — the
 * write root's copy is the one read (`listRecords`, `Store#_walkIds`) and the later claimants are
 * `check`'s violation. Surfaced here because the Store's own duplicate memo is private and this host
 * walks every root anyway; empty for a collection with one root.
 */
export declare function duplicateIds(root: string, d: Descriptor, isStub?: (file: string) => boolean): Map<string, CollectionRoot[]>;
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
export declare function contestedIds(root: string, d: Descriptor, isStub?: (file: string) => boolean): {
    duplicates: Map<string, CollectionRoot[]>;
    stubs: Map<string, CollectionRoot[]>;
};
/** The fields a field verb (remove, rename) can act on: the resolved list minus the three the engine
 *  injects — `id`, `last_modified` (virtual) and `created` (derived) — which no verb may touch. */
export declare function fieldVerbTargets(d: Descriptor): string[];
export declare function titleField(d: Descriptor): string | undefined;
export declare function recordLabel(d: Descriptor, r: RecordEntry): string;
/** The compiled record behind a `ui-view` — its id IS its filename (see `loadUiViews`). */
export declare function uiViewFile(root: string, v: UiView): string;
export declare function loadUiViews(root: string): UiView[];
export declare function operatorId(root: string): string | null;
export declare function matchesFilter(fields: Record<string, any>, filter: Record<string, any>, me: string | null): boolean;
