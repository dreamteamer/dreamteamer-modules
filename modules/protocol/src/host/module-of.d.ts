import type { ModuleRecord } from "./fsdata.js";
/** The module whose root holds `source` (a workspace-relative path) — the longest root wins. */
export declare function moduleOfSource(source: string, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>): string | undefined;
/** `entries` of a parsed manifest → runtime-relative file → owning module id. */
export declare function runtimeModules(entries: Record<string, {
    sources?: Array<{
        path?: string;
    }>;
} | undefined> | undefined, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>): Map<string, string>;
/**
 * The module of one runtime path (relative to `.dreamteamer/`): its own entry; else, for a
 * folder-shaped record such as a skill, an entry inside it — or inside the record folder holding the
 * path. Never wider than the record's own folder (`<kind>/<name>`): a sibling record's module is
 * not this one's.
 */
export declare function moduleOfRuntimeFile(rel: string, map: Map<string, string>): string | undefined;
/** Read the manifest once: an empty map when there is none or it cannot be read — no `$module`, no narrowing. */
export declare function loadRuntimeModules(root: string, modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>): Map<string, string>;
