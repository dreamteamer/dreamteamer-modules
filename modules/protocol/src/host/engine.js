// Ported from the dreamteamer VS Code extension's host side (src/engine.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { EngineTooOldError, meetsFloor } from "./floor.js";
// through new Function, so a bundler building CommonJS (the VS Code extension) keeps a real dynamic import
const esmImport = new Function("specifier", "return import(specifier)");
export const ENGINE_API_VERSION = 1;
let loaded;
let loadedApi;
let resolvedBase = null;
export function engineBase() {
    return resolvedBase;
}
export function engine() {
    if (!loaded)
        throw new Error("dreamteamer engine not loaded yet");
    return loaded;
}
export function engineLoaded() {
    return loaded !== undefined;
}
export function engineRoot(root) {
    const candidates = [path.join(root, "git_modules", "dreamteamer"), path.join(root, "node_modules", "dreamteamer")];
    const found = candidates.find((c) => fs.existsSync(path.join(c, "package.json")));
    if (found)
        return found;
    throw new Error("no dreamteamer engine in this workspace — looked in git_modules/dreamteamer and node_modules/dreamteamer (run: npm install)");
}
export function readEngineVersion(engineDir) {
    try {
        const v = JSON.parse(fs.readFileSync(path.join(engineDir, "package.json"), "utf8")).version;
        return typeof v === "string" ? v : null;
    }
    catch {
        return null;
    }
}
let belowFloor = null;
export function engineBelowFloor() {
    return belowFloor;
}
export async function initEngine(root, opts = {}) {
    const base = engineRoot(root);
    resolvedBase = base;
    const version = readEngineVersion(base);
    const engineLabel = path.relative(root, base) || base;
    belowFloor = null;
    if (opts.minEngine && !meetsFloor(version, opts.minEngine)) {
        const notice = { floor: opts.minEngine, version, engineLabel };
        if (!opts.allowBelowFloor)
            throw new EngineTooOldError(notice);
        belowFloor = notice;
    }
    const apiFile = path.join(base, "src", "api.js");
    if (!fs.existsSync(apiFile)) {
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
        contributedNotes: api["contributedNotes"],
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
        // the nav document (engine 0.49, cr-dt-008): each undefined on an older engine, where the protocol's own
        // reader, name check and writer stand in (nav-doc.js) and there are no fragments to apply
        readNavDoc: api["readNavDoc"],
        validateNavDoc: api["validateNavDoc"],
        writeNavDoc: api["writeNavDoc"],
        applyNavFragments: api["applyNavFragments"],
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
export async function refreshWorkspace() {
    if (!loaded)
        return;
    const ws = await loadedApi.openWorkspace(loaded.ws.root);
    loaded.ws = ws;
    loaded.declaredVars = declaredVarsOf(ws.pkg);
    loaded.namespaces.splice(0, loaded.namespaces.length, ...loadedApi.namespaces(ws.root));
}
