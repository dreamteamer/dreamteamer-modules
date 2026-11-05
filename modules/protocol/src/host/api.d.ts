export interface ApiResult {
    status: number;
    body: unknown;
}
export declare class ApiFailure extends Error {
    status: number;
    constructor(message: string, status: number);
}
export declare class WorkspaceApi {
    root: string;
    private store;
    private manifestMtime;
    private operatorId;
    onSystemWrite: ((result: unknown) => void) | undefined;
    constructor(root: string);
    private activityReads;
    private activityPages;
    private activityScopes;
    private sessionsFrom;
    private activity;
    reload(): void;
    private runtimeModulesCache;
    private runtimeModules;
    private sourcesCache;
    private sourcesCtx;
    private runtimeModuleOf;
    private sourcesOf;
    private contested;
    private stubRootNames;
    private sourceOfFile;
    private mtime;
    private fresh;
    descriptors(): Map<string, any>;
    handle(method: string, rawPath: string, body?: any): Promise<ApiResult>;
    private route;
    private currentHandle;
    private hintUnencoded;
    private runningSessions;
    private holds;
    private listRecords;
    private readRecord;
    private createRecord;
    private patchRecord;
    private systemWrite;
    private fieldWrite;
    private afterFieldWrite;
    private history;
    private historyDiff;
}
export declare function gitHistoryMap(root: string, dirs: string[], repoOf?: (dir: string) => string): Map<string, FileHistory>;
export interface FileHistory {
    modified: string | null;
    by: string | null;
    createdBy: string | null;
}
export declare function parseGitHistory(out: string, keyOf: (line: string) => string, into?: Map<string, FileHistory>): Map<string, FileHistory>;
export declare const SOURCE_KEY = "$source";
export declare const SOURCE_KIND_KEY = "$source-kind";
export declare const STUBS_KEY = "$stubs";
export declare const MODIFIED_BY_KEY = "$last-modified-by";
export declare const CREATED_BY_KEY = "$created-by";
export declare const MODULE_KEY = "$module";
export declare const DUPLICATES_KEY = "$duplicates";
export declare function revisionParam(value: unknown): string;
