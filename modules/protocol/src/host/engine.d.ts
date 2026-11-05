import { type BelowFloorNotice } from "./floor.js";
export declare const ENGINE_API_VERSION = 1;
export interface EngineWorkspace {
    root: string;
    pkg: any;
    extensions: unknown[];
}
export interface EngineNote {
    id: string | null;
    text: string;
    by: string;
    error?: true;
}
export interface DescriptorStorage {
    path: string;
    format: "md" | "yaml" | "json" | "binary";
    shape: "file" | "folder";
    suffix?: string;
    entry?: string;
    repo?: string;
    runtime?: boolean;
    under?: {
        parent: string;
        subfolder: string;
        collection?: string;
        id?: string;
    };
    unavailable?: string | null;
    max_bytes?: number;
    accept?: string[];
    roots: Array<{
        path: string;
        repo?: string;
        layer?: string;
    }>;
    layers: Array<{
        name: string;
        path: string;
        repo?: string;
    }>;
}
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
    Store: any;
    bodyField: (d: any) => string | undefined;
    serialize: (d: any, fields: Record<string, any>) => string;
    parseRecordText: (text: string, d: any, bodyField?: string) => Record<string, any>;
    presentation: (descriptors: Map<string, any>) => any;
    matchesFilter: (row: any, filter: any, resolve?: (ref: string) => any) => boolean;
    readManifest: (root: string) => any;
    staleness: (root: string) => any;
    compile: (ws: EngineWorkspace) => number;
    CompileError: any;
    slugOrHash: (s: string) => string;
    slug: (s: string) => string;
    check: (ws: EngineWorkspace, opts?: {
        extra?: {
            file: string;
            msg: string;
        }[];
    }) => number;
    contributedViolations: (ws: EngineWorkspace) => Promise<{
        file: string;
        msg: string;
    }[]>;
    commandsFor: (store: any, collection: string, ids: string[]) => any;
    contributedNotes?: (ws: EngineWorkspace, collection: string, ids: string[]) => EngineNote[];
    recordResolver: (store: any) => (ref: string) => any;
    distinctValues: (store: any, collection: string, field: string, opts?: {
        limit?: number;
    }) => any;
    commitPending: (store: any, opts?: {
        only?: string[];
        message?: string;
        dryRun?: boolean;
    }) => any[];
    history: (store: any, collection: string, id: string) => unknown;
    historyDiff: (store: any, collection: string, id: string, hash?: string) => unknown;
    sortRows: (rows: any[], sort: string | null | undefined, jsonSchema?: any) => any[];
    renderEnv: (template: string) => string;
    declaredVars: string[];
    placementKey: (rows: {
        id: string;
        key: string;
    }[], id: string, dest: Record<string, unknown>, collection?: string) => string;
    schema: {
        createCollection: Function;
        removeCollection: Function;
        renameCollection: Function;
        moveCollection: Function;
        setCollectionScalars: Function;
        addField: Function;
        updateField: Function;
        removeField: Function;
        removeFieldPlan: Function;
        renameField: Function;
        renameFieldPlan: Function;
        renameValue: Function;
        renameValuePlan: Function;
        fieldFromFlags: Function;
        saveUiView: Function;
        removeUiView: Function;
        moveUiView?: Function;
        createModule: Function;
        setModule: Function;
        renameModule: Function;
        removeModule: Function;
        createSkill: Function;
        refuseHandAuthored: Function;
        removeEntity: Function;
        renameEntity: Function;
        setEntityFrontmatter: Function;
    };
    parseRef: (ref: string) => {
        collection: string;
        id: string;
    } | null;
    namespaces: string[];
    loadDescriptors: (root: string) => Map<string, any> | null;
    descriptor: {
        moduleOf: (d: any) => string | undefined;
        isInternal: (d: any) => boolean;
        isRuntime: (d: any) => boolean;
        isBinary: (d: any) => boolean;
        displayOf: (d: any) => DescriptorDisplay;
        overlaidByOf: (d: any) => string[];
        positionFieldOf: (d: any) => string | undefined;
        storageOf: (d: any) => DescriptorStorage;
        titleOf: (d: any) => string;
        fieldsOf: (d: any) => Record<string, any>;
        idsOf: (d: any) => {
            from?: string | string[];
            pattern?: string;
        };
        jsonSchemaOf: (d: any) => any;
    };
    ws: EngineWorkspace;
}
export declare function engineBase(): string | null;
export declare function engine(): EngineModules;
export declare function engineLoaded(): boolean;
export declare function engineRoot(root: string): string;
export declare function readEngineVersion(engineDir: string): string | null;
export interface InitEngineOptions {
    minEngine?: string;
    allowBelowFloor?: boolean;
}
export declare function engineBelowFloor(): BelowFloorNotice | null;
export declare function initEngine(root: string, opts?: InitEngineOptions): Promise<EngineModules>;
export declare function openWorkspaceAt(dir: string): Promise<EngineWorkspace>;
export declare function refreshWorkspace(): Promise<void>;
