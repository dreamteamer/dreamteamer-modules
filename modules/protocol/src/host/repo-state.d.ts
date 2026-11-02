export declare const REPO_KEY = "$repo";
export declare const DIRTY_KEY = "$dirty";
export declare const AHEAD_KEY = "$ahead";
export interface Located {
    file: string;
    repo: string | null;
}
export declare function locateRecord(store: {
    locate?: (c: string, id: string) => Located;
}, collection: string, id: string): Located | null;
export declare function forgetAhead(): void;
export declare function aheadOf(repoAbs: string, now?: number): number | null;
export declare function isDirty(repoAbs: string, fileAbs: string): boolean;
export declare function repoStateKeys(root: string, located: Located | null): Record<string, unknown>;
