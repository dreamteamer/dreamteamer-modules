import type { ModuleRecord } from "./fsdata.js";
export declare function moduleOfSource(source: string, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>): string | undefined;
export declare function runtimeModules(entries: Record<string, {
    sources?: Array<{
        path?: string;
    }>;
} | undefined> | undefined, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>): Map<string, string>;
export declare function moduleOfRuntimeFile(rel: string, map: Map<string, string>): string | undefined;
export declare function loadRuntimeModules(root: string, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>): Map<string, string>;
