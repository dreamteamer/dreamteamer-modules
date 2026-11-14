import { Descriptor, type ModuleRecord } from "./fsdata.js";
import type { NavDoc, NavTarget } from "../nav-doc.js";
import type { NavNode } from "../nav-model.js";
import { type SourceEntry } from "./sources.js";
export declare function keepsRuntimeRecords(d: Descriptor): boolean;
export declare function shouldFoldOutOfRecordTree(d: Descriptor): boolean;
export declare function routeFor(d: Descriptor): string;
export declare function collectionRow(d: Descriptor, sources?: SourceEntry[]): {
    label: string;
    icon: string | undefined;
    tooltip: string;
    shared?: true;
    count?: number;
};
export declare function folderModule(folder: {
    key: string;
    collections?: ReadonlyArray<{
        name: string;
    }>;
} | {
    layer: string;
}, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "namespaces" | "collections">>): string | undefined;
export declare const MODULE_ICON = "deployed_code";
export declare const PLAIN_FOLDER_ICON = "folder-compact";
export declare const MODULE_MARK = "\u2022";
export declare const SHARED_MARK = "\u26AD";
export declare function rowMarks(marks: {
    module?: boolean;
    shared?: boolean;
}): string | undefined;
export declare function moduleIcon(module: Pick<ModuleRecord, "collections"> | undefined, look: (collection: string) => {
    icon?: string;
    order?: number;
    runtime?: boolean;
} | undefined): string | undefined;
export declare function folderPresentation(module: string | undefined, about?: string, opts?: {
    icon?: string;
    shared?: boolean;
    source?: string;
}): {
    icon: string;
    tooltip?: string;
    route?: string;
    marks?: string;
};
export declare const WORKSPACE_ROUTE = "/settings/schema/activity";
export declare function moduleRoute(id: string, source?: string): string;
export type NavFolder = {
    key: string;
    collections: Descriptor[];
    children: NavFolder[];
};
export declare function groupTopLevel(descriptors: Descriptor[], declared: string[], workspaceModule?: string, dependsOn?: Map<string, string[]>, navGroups?: Map<string, string[]>, namespacesOf?: Map<string, string[]>, titleOf?: Map<string, string | undefined>): {
    top: Descriptor[];
    folders: NavFolder[];
};
export declare function compareChildren(a: NavFolder, b: NavFolder): number;
export declare function foldSameLabel(folders: NavFolder[], titleOf: Map<string, string | undefined>, parentKey?: string): NavFolder[];
export type NavEntry = {
    kind: "collection";
    descriptor: Descriptor;
} | {
    kind: "folder";
    folder: NavFolder;
} | {
    kind: "layers";
    label: string;
    layers: LayerFolder[];
};
export declare const navKey: (e: NavEntry) => string;
export declare function navHiddenOf(raw: unknown): string[];
export declare function withoutHidden(entries: NavEntry[], hidden?: readonly string[]): NavEntry[];
export declare function orderTopLevel(top: Descriptor[], folders: NavFolder[], navOrder?: string[], layers?: (NavEntry & {
    kind: "layers";
}) | Array<NavEntry & {
    kind: "layers";
}>): NavEntry[];
export declare function groupLabel(key: string, titleOf: Map<string, string | undefined>, parentKey?: string): string;
export declare function moduleLabel(id: string, title?: string): string;
export declare const LAYERS_FOLDER_DEFAULT = "Layers";
export declare function layersFolderLabel(raw: unknown): string;
export type LayerGroup = {
    label: string;
    keys: string[];
};
export declare function layerGroups(raw: unknown, keys: string[]): LayerGroup[];
export type LayerRow = {
    collection: string;
    title: string;
    icon: string | undefined;
    count: number;
    route: string;
};
export type LayerFolder = {
    key: string;
    label: string;
    installed: boolean;
    rows: LayerRow[];
};
export type LayerSource = {
    name: string;
    installed: boolean;
    collections: Array<{
        collection: string;
        count: number;
    }>;
};
export declare function layerLabels(keys: string[], titles?: Map<string, string | undefined>): Map<string, string>;
export declare function layerRoute(d: Descriptor, layer: string): string;
export declare function layerFolders(layers: LayerSource[], descriptors: Descriptor[], titles?: Map<string, string | undefined>): LayerFolder[];
export declare function groupedLayerFolders(layers: LayerSource[], descriptors: Descriptor[], raw: unknown, titles?: Map<string, string | undefined>): Array<{
    label: string;
    layers: LayerFolder[];
}>;
export declare function layerNote(l: LayerFolder): string | undefined;
export type LayerEntry = {
    kind: "row";
    row: LayerRow;
} | {
    kind: "folder";
    folder: NavFolder;
    label: string;
    entries: LayerEntry[];
};
export declare function layerEntries(rows: LayerRow[], descriptors: Descriptor[], nav: {
    declared: string[];
    workspaceModule?: string;
    dependsOn?: Map<string, string[]>;
    navGroups?: Map<string, string[]>;
    navOrder?: string[];
    titleOf?: Map<string, string | undefined>;
    namespacesOf?: Map<string, string[]>;
}): LayerEntry[];
/** The unplaced-row order: by title, then name. Passed to applyNavOp as its `collections`. */
export declare function tailOrder(descriptors: ReadonlyArray<{ name: string }>, titleOf?: (d: any) => string): Set<string>;
/** A node key: the letter, then each path element URI-encoded and joined by "/". */
export declare function navPathKey(letter: "f" | "n", path: string[]): string;
/** The tree nav.yaml describes (design §3). `doc` null draws the flat tree. Every folder, namespace and collection
 *  node carries `target`. */
export declare function buildTree(o: {
    descriptors: ReadonlyArray<{ name: string; title?: string; internal?: boolean; display?: any }>;
    doc: NavDoc | null | undefined;
    namespaces?: string[];
    titleOf?: (d: any) => string;
    views?: any[];
    namespaceTitle?: (ns: string, parentNs: string) => string;
    nodeOf?: (d: any) => Partial<NavNode>;
    icon?: (name?: string) => string | undefined;
    internal?: (d: any) => boolean;
}): Array<NavNode & { target?: NavTarget }>;
/** A record layer's tree when its clone holds nav.yaml (design §3 rule 9): buildTree over the rows the layer holds;
 *  a declared namespace it holds no row of draws no folder; every collection node carries its `row`. */
export declare function layerTree(o: {
    rows: LayerRow[];
    descriptors: ReadonlyArray<{ name: string; title?: string; internal?: boolean; display?: any }>;
    doc: NavDoc | null | undefined;
    namespaces?: string[];
    titleOf?: (d: any) => string;
    namespaceTitle?: (ns: string, parentNs: string) => string;
    icon?: (name?: string) => string | undefined;
}): Array<NavNode & { target?: NavTarget; row?: LayerRow }>;
export declare function navGroupsOf(raw: unknown): Map<string, string[]>;
export declare const navOrderOf: (raw: unknown) => string[];
/** Whether any of navGroups · navOrder · navHidden holds something (an empty array or object is unset). */
export declare function hasNavSettings(settings: { navGroups?: unknown; navOrder?: unknown; navHidden?: unknown } | undefined): boolean;
/** The tree the old settings drew: groupTopLevel → orderTopLevel → withoutHidden, unchanged. */
export declare function legacyTree(descriptors: Descriptor[], settings?: { navGroups?: unknown; navOrder?: unknown; navHidden?: unknown }, ctx?: {
    declared?: string[];
    workspaceModule?: string;
    dependsOn?: Map<string, string[]>;
    namespacesOf?: Map<string, string[]>;
    titleOf?: Map<string, string | undefined>;
    layers?: (NavEntry & { kind: "layers" }) | Array<NavEntry & { kind: "layers" }>;
}): NavEntry[];
/** The icon a legacy folder draws (an authored name): its module's look, else the module icon; undefined for a plain folder. */
export declare function legacyFolderIcon(folder: NavFolder, modules: ReadonlyArray<ModuleRecord>, byName: Map<string, Descriptor>): string | undefined;
/** What legacyTree and legacyDoc need of a workspace, from its compiled runtime. */
export declare function legacyContext(root: string): {
    declared: string[];
    workspaceModule: string | undefined;
    dependsOn: Map<string, string[]>;
    namespacesOf: Map<string, string[]>;
    titleOf: Map<string, string | undefined>;
    iconOf: (folder: NavFolder) => string | undefined;
};
