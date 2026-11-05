import { Descriptor, type ModuleRecord } from "./fsdata.js";
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
