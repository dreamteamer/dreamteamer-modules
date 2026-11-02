// THE ENGINE, IN-PROCESS.
//
// ONE engine: the one the WORKSPACE pins, loaded once at activation and held here. Same code `dt`
// runs on the command line, same validation, same commits — called instead of spawned (decision 48).
//
// And ONE module of it: `<engine>/src/api.js`, the engine's PUBLIC API (`import … from 'dreamteamer'`,
// engine 0.31.0). Until 0.21.0 this file deep-imported fifteen internal engine files by path, which
// made every engine refactor a cross-repo break — deleting one internal file took `activate()` down
// before the tree view existed. The engine's package `exports` now hides `src/*`, and the API is the
// contract: `scripts/check-engine-contract.mjs` pins every `api.<name>` read below against a real
// engine's runtime exports and its `api.d.ts`.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { EngineTooOldError, meetsFloor } from "./floor.js";
// esbuild rewrites a literal `import()` to `require()` when bundling for CJS, which cannot load
// the engine's ESM. Going through `new Function` keeps a genuine dynamic import in the output.
const esmImport = (specifier) => import(specifier);
/** The engine API version this extension speaks (`apiVersion` in the engine's `src/api.js`). The
 *  engine bumps it on a breaking change to the API, so a mismatch is refused before anything loads. */
export const ENGINE_API_VERSION = 1;
let loaded;
/** The loaded API module, kept for `refreshWorkspace`'s re-open. */
let loadedApi;
/** Where `initEngine` resolved the engine — the candidate that won. Set before the floor check, so
 *  it is known even in the refused state. Null until `initEngine` has run. */
let resolvedBase = null;
/** The resolved engine directory, for the provenance line. Null before `initEngine`. */
export function engineBase() {
    return resolvedBase;
}
/** The engine, after `initEngine`. Throws if called before activation finished. */
export function engine() {
    if (!loaded)
        throw new Error("dreamteamer engine not loaded yet");
    return loaded;
}
export function engineLoaded() {
    return loaded !== undefined;
}
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
export function engineRoot(root) {
    const candidates = [path.join(root, "git_modules", "dreamteamer"), path.join(root, "node_modules", "dreamteamer")];
    const found = candidates.find((c) => fs.existsSync(path.join(c, "package.json")));
    if (found)
        return found;
    throw new Error("no dreamteamer engine in this workspace — looked in git_modules/dreamteamer and node_modules/dreamteamer (run: npm install)");
}
/** What the WORKSPACE's engine says its own version is, or null when it cannot be read. Not a
 *  guess: `<engineRoot>/package.json`'s `version` is what npm installed and what a release tag
 *  published, and the same file `dt --version` reads. */
export function readEngineVersion(engineDir) {
    try {
        const v = JSON.parse(fs.readFileSync(path.join(engineDir, "package.json"), "utf8")).version;
        return typeof v === "string" ? v : null;
    }
    catch {
        return null;
    }
}
/** Set when the floor was BYPASSED rather than met, so the surface can carry a standing warning.
 *  Null when the engine satisfies the floor, or when no floor was passed. */
let belowFloor = null;
/** The bypass notice, for the status-bar warning. Read after a successful `initEngine`. */
export function engineBelowFloor() {
    return belowFloor;
}
export async function initEngine(root, opts = {}) {
    const base = engineRoot(root);
    resolvedBase = base;
    const version = readEngineVersion(base);
    const engineLabel = path.relative(root, base) || base;
    // ⚠ THE FLOOR IS CHECKED BEFORE THE IMPORT, and the order is the whole point: below the floor NOT
    // ONE engine module is loaded, so the refused state contains nothing that can write, and the
    // message is the floor's (what to install) rather than a module-resolution error.
    belowFloor = null;
    if (opts.minEngine && !meetsFloor(version, opts.minEngine)) {
        const notice = { floor: opts.minEngine, version, engineLabel };
        if (!opts.allowBelowFloor)
            throw new EngineTooOldError(notice);
        // The hatch: a working engine clone carries the last RELEASED version in its package.json until
        // the release tag is pushed, so a floor that is otherwise correct would refuse it. Not a silent
        // downgrade — the caller shows a standing warning.
        belowFloor = notice;
    }
    const apiFile = path.join(base, "src", "api.js");
    if (!fs.existsSync(apiFile)) {
        // Only reachable through the hatch (or a clone whose version was bumped ahead of its code): every
        // engine at or above the floor ships the API. The hatch cannot help here — there is nothing to load.
        throw new Error(`${engineLabel} (v${version ?? "?"}) has no public API (src/api.js) — this extension loads the engine only through it. ` +
            `Install ${opts.minEngine ? `dreamteamer ${opts.minEngine} or later` : "an engine that ships it"}, then Compile and reload.`);
    }
    const api = await esmImport(pathToFileURL(apiFile).href);
    if (api.apiVersion !== ENGINE_API_VERSION) {
        throw new Error(`${engineLabel} (v${version ?? "?"}) exposes engine API version ${String(api.apiVersion)}; ` +
            `this extension requires API version ${ENGINE_API_VERSION}. ` +
            `Install an engine that speaks it (or an extension release that matches this engine), then reload.`);
    }
    const ws = await api.openWorkspace(root);
    // Off the MANIFEST, not package.json — the compiled artifact is the boundary both halves read.
    // ⚠ This array is LIVE: `refreshWorkspace()` splices it, so `parseRef` below and
    // `EngineModules.namespaces` can never disagree (a snapshot here once split every reference into a
    // namespace compiled after the window opened at the wrong slash, silently, until a reload).
    const namespaces = api.namespaces(root);
    loadedApi = api;
    loaded = {
        Store: api.Store,
        bodyField: api.bodyField,
        serialize: api.serialize,
        parseRecordText: api.parseRecordText,
        presentation: api.presentation,
        matchesFilter: api.matchesFilter,
        readManifest: api.readManifest,
        staleness: api.staleness,
        compile: api.compile,
        CompileError: api.CompileError,
        slugOrHash: api.slugOrHash,
        slug: api.slug,
        check: api.check,
        contributedViolations: api.contributedViolations,
        commandsFor: api.commandsFor,
        recordResolver: api.recordResolver,
        distinctValues: api.distinctValues,
        commitPending: api.commitPending,
        history: api.history,
        historyDiff: api.historyDiff,
        sortRows: api.sortRows,
        placementKey: api.placementKey,
        renderEnv: (template) => api.renderTemplate(template, api.envContext(engine().ws)),
        declaredVars: declaredVarsOf(ws.pkg),
        loadDescriptors: api.loadDescriptors,
        descriptor: {
            moduleOf: api.moduleOf,
            isInternal: api.isInternal,
            isRuntime: api.isRuntime,
            isBinary: api.isBinary,
            displayOf: api.displayOf,
            overlaidByOf: api.overlaidByOf,
            positionFieldOf: api.positionFieldOf,
            storageOf: api.storageOf,
            titleOf: api.titleOf,
            fieldsOf: api.fieldsOf,
            idsOf: api.idsOf,
            jsonSchemaOf: api.jsonSchemaOf,
        },
        namespaces,
        parseRef: (ref) => api.parseRef(ref, namespaces),
        schema: {
            createCollection: api.createCollection,
            removeCollection: api.removeCollection,
            renameCollection: api.renameCollection,
            moveCollection: api.moveCollection,
            setCollectionScalars: api.setCollectionScalars,
            addField: api.addField,
            updateField: api.updateField,
            removeField: api.removeField,
            removeFieldPlan: api.removeFieldPlan,
            renameField: api.renameField,
            renameFieldPlan: api.renameFieldPlan,
            renameValue: api.renameValue,
            renameValuePlan: api.renameValuePlan,
            fieldFromFlags: api.fieldFromFlags,
            saveUiView: api.saveUiView,
            removeUiView: api.removeUiView,
            // read by KEY, not as `api.<name>`: the contract script scrapes the dotted reads as REQUIRED
            // exports, and this one is newer than `dreamteamer.minEngine` — fold it into the dotted
            // form when the floor rises past the engine that ships it
            moveUiView: api["moveUiView"],
            createModule: api.createModule,
            setModule: api.setModule,
            renameModule: api.renameModule,
            removeModule: api.removeModule,
            createSkill: api.createSkill,
            refuseHandAuthored: api.refuseHandAuthored,
            removeEntity: api.removeEntity,
            renameEntity: api.renameEntity,
            setEntityFrontmatter: api.setEntityFrontmatter,
        },
        ws,
    };
    return loaded;
}
function declaredVarsOf(pkg) {
    const vars = pkg?.dreamteamer?.vars;
    return Array.isArray(vars) ? vars.filter((v) => typeof v === "string") : [];
}
// ---- another workspace: a record layer, opened as itself ------------------------------------------
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
export function openWorkspaceAt(dir) {
    if (!loadedApi)
        return Promise.reject(new Error("engine not loaded"));
    const key = Symbol.for("dreamteamer.workspace");
    const g = globalThis;
    const had = Object.prototype.hasOwnProperty.call(g, key);
    const prev = g[key];
    g[key] = path.resolve(dir);
    try {
        return Promise.resolve(loadedApi.openWorkspace(dir));
    }
    finally {
        if (had)
            g[key] = prev;
        else
            delete g[key];
    }
}
// ---- staying current without a window reload ----------------------------------------------------
/**
 * Re-read what a COMPILE can have changed: re-OPEN the workspace (its `package.json` — a new module,
 * a new `dreamteamer.namespaces` entry, a newly installed or removed extension — is `compile()`'s own
 * input, so a stale handle compiles the previous shape of the workspace) and the declared namespaces.
 *
 * Deliberately NOT a re-`initEngine`: the engine's API module is the one thing a compile cannot
 * change, and re-importing it would hand out fresh `CompileError` / `Store` classes while old ones are
 * still held in closures — `err instanceof CompileError` in api.ts would start answering false.
 */
export async function refreshWorkspace() {
    if (!loaded)
        return;
    const ws = await loadedApi.openWorkspace(loaded.ws.root);
    loaded.ws = ws;
    loaded.declaredVars = declaredVarsOf(ws.pkg);
    // splice, never reassign: `parseRef` closed over this exact array (see initEngine)
    loaded.namespaces.splice(0, loaded.namespaces.length, ...loadedApi.namespaces(ws.root));
}
