import { type Descriptor, type ModuleRecord } from "./fsdata.js";
export type SourceKind = "own" | "layer" | "module";
/**
 * WHAT A ROOT IS, for the question "does a write land there" (cr-vscode-004). `kind` says where the
 * name comes from (the workspace, a layer key, a module id); `via` says what the folder IS:
 *
 *   own      the workspace's own root, or a module inside the workspace repo
 *   clone    a module's folder in a git clone — a `git_modules` bundle, an inline `modules/<m>` folder,
 *            or a package `dt-setup link`ed to a modules clone (its realpath leaves `node_modules`)
 *   layer    a record layer, `git_modules/<key>`
 *   package  a module installed from the registry — its folder resolves inside `node_modules`
 */
export type SourceVia = "own" | "clone" | "layer" | "package";
/**
 * WHETHER A WRITE FROM THIS WORKSPACE LANDS IN THE ROOT:
 *
 *   write   edits land in place AND a new record can be added there
 *   edit    edits land in place; a new record cannot be added there from here (a layer whose clone is
 *           not compiled — adding into it is `dt add -w <layer>`, which runs in the layer's own runtime)
 *   read    nothing is written from here (an installed package; a layer that is not installed)
 */
export type SourceAccess = "write" | "edit" | "read";
/** One root of a collection, named. What a list row's `$source` names and the Sources section lists. */
export interface SourceEntry {
    /** The root's NAME — the value of `$source`. */
    name: string;
    kind: SourceKind;
    /** The git repo holding the root, workspace-relative (`.` is the workspace). Where an edit commits. */
    repo: string;
    /** The root's folder, workspace-relative. */
    path: string;
    /** False for a layer whose clone is absent — a fresh checkout before `dreamteamer install`: its
     *  records are not read, and `check` says so once. */
    installed: boolean;
    /** Records READ from this root — ids this root is the first to claim (the write root wins a
     *  duplicate, as `dt get` answers). */
    count: number;
    /** The `repos` record whose `url` matches this root's remote (`repos/<id>`), when one does. The
     *  webview renders the source as a link to it then, plain text otherwise — never a dangling ref. */
    record?: string;
    /** What the folder is — see `SourceVia`. */
    via: SourceVia;
    /** Whether a write from this workspace lands there — see `SourceAccess`. */
    access: SourceAccess;
    /** The reason, in a sentence, for anything short of `write` — what the record page and the
     *  target choice print. */
    note?: string;
}
/** What every source computation reads once per request — the package, the modules, the repos. */
export interface SourcesContext {
    /** The workspace root — what a module's folder is resolved against to tell a linked clone from an
     *  installed package. Absent (a pure test), a `node_modules` path is a package. */
    root?: string;
    /** The workspace's own name — `package.json` `name`. */
    workspace: string;
    modules: ModuleRecord[];
    /** `dreamteamer.git_modules` of the root package: name → entry. */
    gitModules: Record<string, {
        url?: string;
        records?: string[];
        module?: boolean;
    }>;
    /** The `git_modules` keys that ARE record layers (`layerKeys`) — never decided from `records` alone. */
    layers: Set<string>;
    /** Every `repos` record's `url`, by id. */
    repos: Array<{
        id: string;
        url: string;
    }>;
    /** `origin` of each installed `git_modules/<name>` clone, by repo path — asked once. */
    origins: Map<string, string | undefined>;
}
/**
 * Build the context from the workspace: the root package (name, `git_modules`), the compiled module
 * records (a module's `path`, to tell a module-owned write root from the workspace's own), the
 * `repos` records (to match a remote), and each installed clone's origin.
 */
export declare function sourcesContext(root: string, iterable: Iterable<Descriptor>): SourcesContext;
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
export declare function layerKeys(gitModules: SourcesContext["gitModules"], descriptors: Iterable<Descriptor>): Set<string>;
/**
 * Two git remotes naming one repository. Exact after the spellings every clone varies — a trailing
 * `.git`, a trailing slash, case — and NOTHING cleverer: a host alias in an SSH config (`host-work`
 * for `host`) is a fact about one machine, and guessing at it would link a source to the wrong
 * `repos` record with no error anywhere. A clone's own `origin` is asked as well as the declared
 * `url`, so the alias the operator cloned with matches the record spelled the same way.
 */
export declare function sameRemote(a: string | undefined, b: string | undefined): boolean;
/** The `repos` record matching any of these remotes, as a reference, or undefined. */
export declare function repoRecordFor(remotes: Array<string | undefined>, repos: SourcesContext["repos"]): string | undefined;
/**
 * Every root of `d`, NAMED, in the engine's order (write root first) with the records each one is
 * read for. The one derivation behind the list row's `$source`, the collection row's `sources`, the
 * tree's "from org", the hover's "from project-a" and the Sources section.
 */
export declare function collectionSources(root: string, d: Descriptor, ctx: SourcesContext): SourceEntry[];
/**
 * Is a module folder an INSTALLED PACKAGE — under `node_modules` once symlinks are resolved? A package
 * `dt-setup link`ed to a modules clone is a symlink out of `node_modules` into a git working tree, and
 * a write to it lands in that clone; a registry install is replaced on the next `npm install`. Without
 * a root to resolve against (a pure test), the path alone answers.
 */
export declare function isInstalledPackage(rel: string, root?: string): boolean;
/**
 * A record layer's writability for ONE collection. Installed and compiled for it: `write` — a new
 * record is added there through the layer's own workspace, as `dt add <c> -w <layer>` adds it (engine
 * 0.41.0), which needs the layer's runtime. Installed but not compiled for it: `edit` — its records are
 * edited in place (the engine writes a layer file where it is), and the note names the command that
 * makes it a target. Not installed: `read`, nothing is read from it either.
 */
export declare function layerAccess(root: string, layer: string, repo: string, collection: string | undefined, installed: boolean): Pick<SourceEntry, "via" | "access" | "note">;
/** Has the layer's clone compiled this collection (or, with none named, anything at all) — the runtime
 *  a write in the layer's own workspace reads? */
export declare function layerCompiles(root: string, repo: string, collection: string | undefined): boolean;
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
export declare function moduleSource(mod: Pick<ModuleRecord, "id" | "path"> | undefined, ctx: SourcesContext): Omit<SourceEntry, "count">;
/** A runtime kind's sources, one per distinct `moduleSource` of its rows, counted — own, then the
 *  layers, then the modules, each by name. `modules` is the module id of every row. */
export declare function runtimeSources(modules: Iterable<string | undefined>, ctx: SourcesContext): SourceEntry[];
/**
 * The source a FILE of `d` was read from — the longest root containing it, the same rule
 * `fileToRecord` and the engine's `layerOfFile` follow. The write root's entry when no layer holds
 * the file (which is what `Store#layerOfFile`'s null means). Undefined for a file in no root.
 */
export declare function sourceOfFile(root: string, d: Descriptor, file: string, sources: SourceEntry[]): SourceEntry | undefined;
/**
 * What a collection row SAYS about its sources, for a tree row or a hover: the foreign roots that
 * actually hold records — the workspace's own root is never counted, so a workspace using neither
 * layers nor module-owned lists reads exactly as before.
 *
 *   one foreign root     `from org`
 *   several              `from 3 layers` (`from 2 sources` when they mix layers and a module)
 *   an absent layer      `· project-a not installed` appended — no count, no mark
 */
export declare function describeSources(sources: SourceEntry[]): {
    description?: string;
    detail: string[];
};
/**
 * The filter WITHOUT its `$source` clauses — what the source picker counts over, so a source the
 * operator has not picked still says how many records it holds rather than 0. Only an AND (or a single
 * clause) can lose a clause without changing what the rest means; an OR is returned as it is, and the
 * counts then follow the full filter, as they did before the picker. Undefined when nothing is left.
 */
export declare function withoutSourceClauses(filter: unknown): unknown;
/** One layer or module of the Sources section: the root, its state, and the collections it holds. */
export interface SourceStackEntry extends Omit<SourceEntry, "count" | "path"> {
    /** The declared remote, where there is one. */
    url?: string;
    /** Each collection this root contributes to, with the records read from it. */
    collections: Array<{
        collection: string;
        path: string;
        count: number;
    }>;
}
/**
 * THE STACK, top to bottom, as `dt status` prints its `layers:` block — the workspace's own data,
 * each declared layer (installed or not, with the collections it contributes and their counts), and
 * each module-owned collection under its module. Derived from the compiled roots across every
 * descriptor plus the root package's `git_modules`; a layer declared but contributing to no compiled
 * collection is still listed, because the Sources section is where "why is nothing read from it"
 * gets answered.
 */
export declare function sourcesStack(root: string, descriptors: Descriptor[], ctx: SourcesContext): {
    workspace: SourceStackEntry;
    layers: SourceStackEntry[];
    modules: SourceStackEntry[];
};
/**
 * A record layer's AUTHORED title, if its clone's `package.json` carries one — `dreamteamer.title`
 * first (where a module titles itself), then a top-level `title`. Undefined for an absent clone, an
 * unreadable package or no title; the nav then derives a label from the key (`layerLabels`).
 */
export declare function layerTitle(root: string, key: string): string | undefined;
