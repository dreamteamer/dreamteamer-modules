import { type BelowFloorNotice } from "./floor.js";
/** The engine API version this extension speaks (`apiVersion` in the engine's `src/api.js`). The
 *  engine bumps it on a breaking change to the API, so a mismatch is refused before anything loads. */
export declare const ENGINE_API_VERSION = 1;
/** The workspace handle every engine entry point takes — from `openWorkspace`, so it carries the
 *  workspace's ACTIVATED extensions. A raw `{ root, pkg }` compile rejects an extension-contributed
 *  source folder (`proofs/`, say) as unknown; only this handle compiles it. */
export interface EngineWorkspace {
    root: string;
    pkg: any;
    extensions: unknown[];
}
/** `storageOf`'s answer (engine `Storage` in records-api.d.ts). */
export interface DescriptorStorage {
    path: string;
    format: "md" | "yaml" | "json" | "binary";
    shape: "file" | "folder";
    suffix?: string;
    entry?: string;
    repo?: string;
    runtime?: boolean;
    /** Stored INSIDE the folder of the record `parent` names: `<parent root>/<parent id>/<subfolder>/…`. */
    under?: {
        parent: string;
        subfolder: string;
        collection?: string;
        id?: string;
    };
    max_bytes?: number;
    /** Binary only: the file extensions a record may carry. */
    accept?: string[];
    /**
     * Every root a record can be READ from, write root first, then each record layer (engine 0.35.0) —
     * another workspace cloned under `git_modules/` — one listing this collection in `records`, or (engine
     * 0.41.0) one read whole because the clone names its `workspace_module`. Always
     * answered on an engine at the floor (0.36.0); read it through `fsdata.collectionRoots`.
     */
    roots: Array<{
        path: string;
        repo?: string;
        layer?: string;
    }>;
    /** The record layers alone (`roots` minus the write root), engine 0.35.0. */
    layers: Array<{
        name: string;
        path: string;
        repo?: string;
    }>;
}
/** `displayOf`'s answer — the sub-blocks this extension reads are typed, the rest pass through. */
export interface DescriptorDisplay {
    nav?: {
        icon?: string;
        order?: number;
        section?: string;
    };
    list?: Record<string, any>;
    record?: Record<string, any>;
    form?: Record<string, any>;
}
export interface EngineModules {
    /** the validating store: readAll / read / add / addFile / set / rm / rename / revert */
    Store: any;
    bodyField: (d: any) => string | undefined;
    serialize: (d: any, fields: Record<string, any>) => string;
    parseRecordText: (text: string, d: any, bodyField?: string) => Record<string, any>;
    presentation: (descriptors: Map<string, any>) => any;
    /** ⚠ Takes a RESOLVER. Without it a relational condition fails CLOSED — a nested filter matches
     *  nothing, silently. See `recordResolver`. */
    matchesFilter: (row: any, filter: any, resolve?: (ref: string) => any) => boolean;
    readManifest: (root: string) => any;
    staleness: (root: string) => any;
    /** `dreamteamer compile` — sources → `.dreamteamer/`. Reports by PRINTING (capture console to read
     *  it) and throws `CompileError` on a bad source. Always called with `ws`. */
    compile: (ws: EngineWorkspace) => number;
    CompileError: any;
    slugOrHash: (s: string) => string;
    /** The template grammar's `slug` filter — what a ui-view's id is made of (`{{ route | slug }}`). */
    slug: (s: string) => string;
    /** report-only validation; prints its findings and returns 0 clean · 1 violations · 2 no runtime.
     *  `extra` is what `contributedViolations` gathered — reported after the schema's, as `dt check` does. */
    check: (ws: EngineWorkspace, opts?: {
        extra?: {
            file: string;
            msg: string;
        }[];
    }) => number;
    /** every installed extension's `check` contribution (engine 0.33.0) — `dt check` passes these to
     *  `check` as `extra`, so an in-process check that skips them reports clean where the CLI fails. */
    contributedViolations: (ws: EngineWorkspace) => Promise<{
        file: string;
        msg: string;
    }[]>;
    /** bound commands + per-record state (the Commands tab) */
    commandsFor: (store: any, collection: string, ids: string[]) => any;
    /** Memoized `<collection>/<id>` → record, for one filter pass. */
    recordResolver: (store: any) => (ref: string) => any;
    /** the vocabulary a field actually uses, for filter-value dropdowns */
    distinctValues: (store: any, collection: string, field: string, opts?: {
        limit?: number;
    }) => any;
    /** `dt commit` — publish the record writes already on disk. */
    commitPending: (store: any, opts?: {
        only?: string[];
        message?: string;
        dryRun?: boolean;
    }) => any[];
    /** git-backed revisions / patch for one record. NOT reimplemented here — a system-stored record's
     *  file lives in the gitignored runtime, and only the engine maps it back to its sources. */
    history: (store: any, collection: string, id: string) => unknown;
    historyDiff: (store: any, collection: string, id: string, hash?: string) => unknown;
    /** `?sort=` ordering. NOT reimplemented here: a `date-time` carries its own offset, so ordering
     *  compares instants — a `localeCompare` puts `…T12:00+03:00` after `…T11:00+01:00`. Given the
     *  collection's JSON Schema (`descriptor.jsonSchemaOf`), an enum field sorts by its declared order (engine 0.33.0). */
    sortRows: (rows: any[], sort: string | null | undefined, jsonSchema?: any) => any[];
    /** `${env:NAME}` → a value on this machine, exactly as `dt resolve` renders it. */
    renderEnv: (template: string) => string;
    /** The workspace's declared `dreamteamer.vars`, the names a template may use. `[]` when none. */
    declaredVars: string[];
    /** manual ordering — the key generator lives in the engine, so its alphabet has one home */
    placementKey: (rows: {
        id: string;
        key: string;
    }[], id: string, dest: Record<string, unknown>, collection?: string) => string;
    /**
     * The SOURCE-WRITING half of the engine. `api.ts`'s routing table calls these by name; each is
     * listed explicitly (rather than handing over the whole API) because this block IS the contract
     * `scripts/check-engine-contract.mjs` scrapes — a rename in the engine fails that gate, not a click.
     */
    schema: {
        createCollection: Function;
        removeCollection: Function;
        /** Descriptor, records, filenames and inbound references, in one commit. */
        renameCollection: Function;
        /** `dt set collections/<n> module=<m>` — THE MOVE. Records stay where they are. Takes `dryRun`. */
        moveCollection: Function;
        /** `dt set collections/<c> <key>=<value>` — the collection-level keys by their v2 path
         *  (`description`, `use_when`, `title`, `record_title`, `display.nav.icon`, `display.nav.order`,
         *  `display.list.columns`, …). An empty value removes the key. */
        setCollectionScalars: Function;
        /** `(ws, store, collection, { name, field, moduleId })` — `field` is a WHOLE v2 field. */
        addField: Function;
        /** `(ws, store, collection, field, { flags } | { field }, moduleId)` — the flag vocabulary
         *  applied over the field as its source declares it, or a whole v2 field that replaces it. */
        updateField: Function;
        removeField: Function;
        /** ⚠ `remove-field`'s plan is a SEPARATE read-only export, not a flag on the op: routing a dry
         *  run to the op itself would clear the values it was asked to count. `(ws, store, …)`. */
        removeFieldPlan: Function;
        /** rewrites the key in every record, descriptor and view that names the field */
        renameField: Function;
        renameFieldPlan: Function;
        /** `dt rename-value <c> <field> <old> <new>` — one enum value, in every record and every
         *  position that names it, in one commit. Takes `dryRun`. */
        renameValue: Function;
        renameValuePlan: Function;
        /** `(store, flags, previous?)` — one v2 field from the field verbs' flag vocabulary (`type`,
         *  `many`, `required`, `unique`, `enum`, `mirror-of`, `on-delete`, `default-value`, …). */
        fieldFromFlags: Function;
        /** An UPSERT of a whole view — "Save as view" saves an existing view as often as a new one. */
        saveUiView: Function;
        removeUiView: Function;
        /** `dt set ui-views/<id> module=<m>` — THE MOVE of a view's source. OPTIONAL: newer than the
         *  floor, so it is not part of the scraped contract; absent, `api.ts`'s `op` refuses the move
         *  naming it. Takes `dryRun`. */
        moveUiView?: Function;
        /** `dt add modules --name <id>` — folder, package.json and every kind folder, scaffolded. */
        createModule: Function;
        setModule: Function;
        renameModule: Function;
        /** Takes `force` and `dryRun`: it refuses while the module still ships things, and says what. */
        removeModule: Function;
        /** The one scaffoldable identity entity. `--description` is required. */
        createSkill: Function;
        /** THROWS, by design — `agents` · `commands` · `command-bindings` · `mixins` are hand-authored,
         *  and the refusal names the path to write. */
        refuseHandAuthored: Function;
        removeEntity: Function;
        renameEntity: Function;
        setEntityFrontmatter: Function;
    };
    /** Split `<collection>/<id>` using this workspace's DECLARED namespaces. Never reimplemented here:
     *  a collection name may carry a slash (`health/doctors`) and an id is also a slash path, so the
     *  boundary is only decidable against the declared set. */
    parseRef: (ref: string) => {
        collection: string;
        id: string;
    } | null;
    /** The workspace's declared namespaces, longest-first.
     *  ⚠ MUTATED IN PLACE by `refreshWorkspace()` — never copy it into a local and hold that. */
    namespaces: string[];
    /** The compiled descriptors, keyed by name — the ENGINE's loader. See fsdata.loadDescriptors.
     *  `null` when the workspace has no compiled runtime yet. */
    loadDescriptors: (root: string) => Map<string, any> | null;
    /**
     * THE DESCRIPTOR ACCESSORS (engine `src/descriptor.js`, exported by the public API) — the ONE way
     * this extension asks a compiled descriptor what it is. A compiled descriptor is the authored v2
     * keys plus the `compiled` block compile wrote (`defaults`, `module`, `runtime`, `overlaid_by`,
     * `fields`, `json_schema`, …), and which of the two halves answers a question is the engine's
     * business: `storageOf` merges the authored storage over `compiled.defaults.storage`, `displayOf`
     * the authored display over the defaulted one. Reading a key here instead would be a second answer
     * to a question the engine already answers, and the two would disagree the first time the shape
     * moves — which is what the v1 reads of `owner`, `group`, `overlays`, `storage.base`,
     * `storage.codec` and `sort_field` did when the v1 keys were deleted from the compiled output.
     */
    descriptor: {
        /** The module that OWNS the collection, as a bare id (`compiled.module`). */
        moduleOf: (d: any) => string | undefined;
        /** `internal: true` — workspace plumbing, drawn on the schema surface, not in the record tree. */
        isInternal: (d: any) => boolean;
        /** Records are build output written by compile — a write goes through the compile gate. */
        isRuntime: (d: any) => boolean;
        /** Records are opaque files (`storage.format: binary`). */
        isBinary: (d: any) => boolean;
        /** The `display` block, authored over defaults, one sub-block at a time (`nav`, `list`, …). */
        displayOf: (d: any) => DescriptorDisplay;
        /** The modules contributing an overlay to this collection, by bare id. */
        overlaidByOf: (d: any) => string[];
        /** The one `type: position` field — what manual ordering writes — or undefined. */
        positionFieldOf: (d: any) => string | undefined;
        /** Storage, resolved: path, format, shape, suffix, entry, under, accept. */
        storageOf: (d: any) => DescriptorStorage;
        /** What to call the collection. */
        titleOf: (d: any) => string;
        /** The resolved fields, injected ones (`id`, `created`, `last_modified`) included, in form order. */
        fieldsOf: (d: any) => Record<string, any>;
        /** How ids are made: `{ from, pattern }`. */
        idsOf: (d: any) => {
            from?: string | string[];
            pattern?: string;
        };
        /** The JSON Schema the validator runs — what `sortRows` reads a declared enum order off. */
        jsonSchemaOf: (d: any) => any;
    };
    /** The workspace handle from `openWorkspace`. REPLACED by `refreshWorkspace()` — read it through
     *  `engine().ws` at the call, never hold it. */
    ws: EngineWorkspace;
}
/** The resolved engine directory, for the provenance line. Null before `initEngine`. */
export declare function engineBase(): string | null;
/** The engine, after `initEngine`. Throws if called before activation finished. */
export declare function engine(): EngineModules;
export declare function engineLoaded(): boolean;
/**
 * Resolve the workspace's own engine — never a copy bundled into the extension, and never a
 * DIFFERENT copy from the one `dt` runs on the command line.
 *
 * THE SAME precedence the engine's own bin applies (`bin/dreamteamer.js#findDevClone`, decision 24),
 * and exactly it: a working clone at `git_modules/dreamteamer` shadows the npm-installed package,
 * and nothing else does. Pinned by test/unit/engine-root.test.ts; a candidate added here without the
 * CLI learning it loads a different validator than the one `dt` commits with.
 *
 * A candidate is accepted on its `package.json` alone, NOT on the API file: an engine too old to have
 * `src/api.js` must still be FOUND, so the floor can refuse it by version and name the install —
 * rather than this reporting "no engine" for a workspace that plainly has one.
 */
export declare function engineRoot(root: string): string;
/** What the WORKSPACE's engine says its own version is, or null when it cannot be read. Not a
 *  guess: `<engineRoot>/package.json`'s `version` is what npm installed and what a release tag
 *  published, and the same file `dt --version` reads. */
export declare function readEngineVersion(engineDir: string): string | null;
export interface InitEngineOptions {
    /** `dreamteamer.minEngine` out of the extension's own manifest. Omitted = no floor, which is what
     *  the tier-1 API tests want: they pin route behaviour, not the release matrix. */
    minEngine?: string;
    /** `dreamteamer.engine.allowBelowFloor` — the one escape hatch (see floor.ts). */
    allowBelowFloor?: boolean;
}
/** The bypass notice, for the status-bar warning. Read after a successful `initEngine`. */
export declare function engineBelowFloor(): BelowFloorNotice | null;
export declare function initEngine(root: string, opts?: InitEngineOptions): Promise<EngineModules>;
/**
 * Open ANOTHER workspace through the same engine — a record layer's clone, which is a workspace of its
 * own (cr-vscode-004: a new record added INTO a layer). `dt add <c> -w <layer>` (engine 0.41.0) is the
 * CLI's spelling of the same act, and this is its mechanism, reproduced through the public API:
 *
 * ⚠ Discovery CLIMBS OUT of a clone under `git_modules/` — it is nested as a module of the workspace
 * around it — so a plain `openWorkspace(<clone>)` answers the READER, and a write would land in the
 * reader while reporting success. The engine's own answer is a PROCESS-LOCAL pin,
 * `globalThis[Symbol.for('dreamteamer.workspace')]`, which `bin/dreamteamer.js` sets for `-w` and
 * `findWorkspace` reads (0.41.0). It is set here only around the SYNCHRONOUS part of the call —
 * `openWorkspace` runs `findWorkspace` before its first `await` — and restored before this function
 * yields, so no other open (a `refreshWorkspace`, another tab) can ever see it. The caller still checks
 * the root it got back: an engine older than the pin climbs out regardless.
 */
export declare function openWorkspaceAt(dir: string): Promise<EngineWorkspace>;
/**
 * Re-read what a COMPILE can have changed: re-OPEN the workspace (its `package.json` — a new module,
 * a new `dreamteamer.namespaces` entry, a newly installed or removed extension — is `compile()`'s own
 * input, so a stale handle compiles the previous shape of the workspace) and the declared namespaces.
 *
 * Deliberately NOT a re-`initEngine`: the engine's API module is the one thing a compile cannot
 * change, and re-importing it would hand out fresh `CompileError` / `Store` classes while old ones are
 * still held in closures — `err instanceof CompileError` in api.ts would start answering false.
 */
export declare function refreshWorkspace(): Promise<void>;
