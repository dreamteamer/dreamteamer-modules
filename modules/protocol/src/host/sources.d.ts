import { type Descriptor, type ModuleRecord } from "./fsdata.js";
export type SourceKind = "own" | "layer" | "module";
export type SourceVia = "own" | "clone" | "layer" | "package";
export type SourceAccess = "write" | "edit" | "read";
export interface SourceEntry {
    name: string;
    kind: SourceKind;
    repo: string;
    path: string;
    installed: boolean;
    count: number;
    record?: string;
    via: SourceVia;
    access: SourceAccess;
    note?: string;
}
export interface SourcesContext {
    root?: string;
    workspace: string;
    modules: ModuleRecord[];
    gitModules: Record<string, {
        url?: string;
        records?: string[];
        module?: boolean;
    }>;
    layers: Set<string>;
    repos: Array<{
        id: string;
        url: string;
    }>;
    origins: Map<string, string | undefined>;
}
export declare function sourcesContext(root: string, iterable: Iterable<Descriptor>): SourcesContext;
export declare function layerKeys(gitModules: SourcesContext["gitModules"], descriptors: Iterable<Descriptor>): Set<string>;
export declare function sameRemote(a: string | undefined, b: string | undefined): boolean;
export declare function repoRecordFor(remotes: Array<string | undefined>, repos: SourcesContext["repos"]): string | undefined;
export declare function collectionSources(root: string, d: Descriptor, ctx: SourcesContext): SourceEntry[];
export declare function isInstalledPackage(rel: string, root?: string): boolean;
export declare function layerAccess(root: string, layer: string, repo: string, collection: string | undefined, installed: boolean): Pick<SourceEntry, "via" | "access" | "note">;
export declare function layerCompiles(root: string, repo: string, collection: string | undefined): boolean;
export declare function moduleSource(mod: Pick<ModuleRecord, "id" | "path"> | undefined, ctx: SourcesContext): Omit<SourceEntry, "count">;
export declare function runtimeSources(modules: Iterable<string | undefined>, ctx: SourcesContext): SourceEntry[];
export declare function sourceOfFile(root: string, d: Descriptor, file: string, sources: SourceEntry[]): SourceEntry | undefined;
export declare function describeSources(sources: SourceEntry[]): {
    description?: string;
    detail: string[];
};
export declare function withoutSourceClauses(filter: unknown): unknown;
export interface SourceStackEntry extends Omit<SourceEntry, "count" | "path"> {
    url?: string;
    collections: Array<{
        collection: string;
        path: string;
        count: number;
    }>;
}
export declare function sourcesStack(root: string, descriptors: Descriptor[], ctx: SourcesContext): {
    workspace: SourceStackEntry;
    layers: SourceStackEntry[];
    modules: SourceStackEntry[];
};
export declare function layerTitle(root: string, key: string): string | undefined;
export declare function withoutUserinfo(url: string | undefined): string | undefined;
export declare function declaredUrl(ctx: Pick<SourcesContext, "gitModules">, key: string | undefined): string | undefined;
