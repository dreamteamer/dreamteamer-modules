export declare const EXT: Record<string, string>;
export interface Descriptor {
    name: string;
    [key: string]: any;
}
export interface ViewDisplay {
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
export interface UiView {
    id: string;
    name?: string;
    title?: string;
    description?: string;
    route: string;
    scope: "record" | "collection" | "page";
    collection?: string;
    filter?: Record<string, any>;
    display?: ViewDisplay;
    compiled?: {
        display?: ViewDisplay;
    };
}
export declare function viewDisplay(v: UiView): ViewDisplay;
export declare function viewLabel(v: UiView): string;
export declare function navViewsOf(views: UiView[], collection: string): UiView[];
export declare function viewRow(v: UiView): {
    label: string;
    icon: string;
    description?: string;
    tooltip: string;
};
export declare function viewCollection(v: UiView): string;
export interface RecordEntry {
    id: string;
    file: string;
    fields: Record<string, any>;
}
export declare function findWorkspaceRoot(folders: readonly {
    fsPath: string;
}[]): string | undefined;
export declare function isRuntime(d: Descriptor): boolean;
export declare function isInternal(d: Descriptor): boolean;
export declare function systemDir(root: string, kind: string): string;
export interface ModuleRecord {
    id: string;
    name: string;
    title?: string;
    channel?: string;
    path?: string;
    location?: string;
    dependencies?: string[];
    namespaces?: string[];
    collections?: string[];
}
export declare function moduleDependencies(root: string): Map<string, string[]>;
export declare function moduleNamespaces(root: string): Map<string, string[]>;
export declare function loadModules(root: string): ModuleRecord[];
export declare function workspaceModule(root: string): string | undefined;
export declare function workspaceName(root: string): string;
export declare function loadDescriptors(root: string): Descriptor[];
export interface CollectionRoot {
    dir: string;
    repo: string;
    layer?: string;
}
export declare function collectionRoots(root: string, d: Descriptor): CollectionRoot[];
export declare function collectionDir(root: string, d: Descriptor): string;
export declare function repoOfPath(root: string, descriptors: Iterable<Descriptor>, abs: string): string;
export declare function isUnderRecordRoot(root: string, descriptors: Iterable<Descriptor>, abs: string): boolean;
export declare function parseRecordText(text: string, d: Descriptor, bodyField?: string): Record<string, any>;
export declare function serializeRecord(d: Descriptor, fields: Record<string, any>): string;
export declare function bodyFieldOf(d: Descriptor): string | undefined;
export declare function parseRecord(file: string, d: Descriptor): Record<string, any>;
export declare function fileToRecord(root: string, descriptors: Descriptor[], fsPath: string): {
    d: Descriptor;
    id: string;
} | undefined;
export declare function recordRoots(root: string, d: Descriptor, descriptors?: Descriptor[]): string[];
export declare function recordFileFor(root: string, d: Descriptor, id: string, descriptors?: Descriptor[]): string | undefined;
export declare function listRecords(root: string, d: Descriptor): RecordEntry[];
export declare function walkIds(dir: string, d: Descriptor): Map<string, string>;
export declare function duplicateIds(root: string, d: Descriptor, isStub?: (file: string) => boolean): Map<string, CollectionRoot[]>;
export declare function contestedIds(root: string, d: Descriptor, isStub?: (file: string) => boolean): {
    duplicates: Map<string, CollectionRoot[]>;
    stubs: Map<string, CollectionRoot[]>;
};
export declare function fieldVerbTargets(d: Descriptor): string[];
export declare function titleField(d: Descriptor): string | undefined;
export declare function recordLabel(d: Descriptor, r: RecordEntry): string;
export declare function uiViewFile(root: string, v: UiView): string;
export declare function loadUiViews(root: string): UiView[];
export declare function operatorId(root: string): string | null;
export declare function matchesFilter(fields: Record<string, any>, filter: Record<string, any>, me: string | null): boolean;
