import type { ModuleRecord } from "./fsdata.js";
export interface ActivityRecord {
    collection: string;
    id: string;
    title?: string;
}
export interface ActivityEntry {
    sha: string;
    repo: string;
    source: string;
    author: string;
    date: string;
    subject: string;
    records: ActivityRecord[];
    files: number;
}
export interface ActivityScope {
    repo: string;
    paths: string[];
}
export declare function repoOf(root: string, rel: string): string;
export declare function recordScopes(root: string, dirs: string[]): ActivityScope[];
export declare function moduleScope(root: string, module: Pick<ModuleRecord, "id" | "path" | "location">, workspaceModule: string | undefined, recordDirsOf: (module: string) => string[]): ActivityScope | undefined;
export declare function repoName(repo: string, workspace: string): string;
export declare function parseActivityLog(out: string, repo: string): Array<Omit<ActivityEntry, "records" | "files" | "source"> & {
    paths: string[];
}>;
export declare const ACTIVITY_PAGE = 20;
export declare const ACTIVITY_BUDGET_MS = 3000;
export declare const ACTIVITY_GRACE_MS = 150;
export declare const ACTIVITY_GIT_TIMEOUT_MS = 60000;
export declare const ACTIVITY_READ_RETENTION_MS = 60000;
type LogEntries = ReturnType<typeof parseActivityLog>;
export declare function logArgs(scope: ActivityScope, limit: number): string[];
export declare function readLog(root: string, scope: ActivityScope, limit: number, timeoutMs?: number): Promise<LogEntries>;
export interface ActivityPage {
    entries: ActivityEntry[];
    hasMore: boolean;
    pending: string[];
    failed: string[];
    settled: number;
}
export interface ScopeRead {
    state: "reading" | "done" | "failed";
    entries: LogEntries;
    settled: Promise<void>;
    at: number;
}
export declare function activityFeed(root: string, scopes: ActivityScope[], page: {
    limit: number;
    offset: number;
    workspace: string;
    settled?: number;
}, recordOf: (workspaceRel: string) => ActivityRecord | undefined, opts?: {
    read?: (scope: ActivityScope, limit: number) => Promise<LogEntries>;
    reads?: Map<string, ScopeRead>;
    budgetMs?: number;
    graceMs?: number;
    previous?: ActivityPage;
}): Promise<ActivityPage>;
export {};
