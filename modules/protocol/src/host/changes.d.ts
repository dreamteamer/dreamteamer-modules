export type ChangeScope = "schema" | "data";
export declare function strongerScope(a: ChangeScope | undefined, b: ChangeScope | undefined): ChangeScope;
export declare function changeScope(root: string, file: string): ChangeScope;
export declare const RECORD_WATCH_GLOB = "{data,state,.dreamteamer,git_modules,modules}/**";
/** The root file the left nav is read from: a change to it is watched (a data change). */
export declare const NAV_DOC_FILE = "nav.yaml";
export declare function isWatchedChange(root: string, file: string, underRecordRoot: (file: string) => boolean): boolean;
export interface InvalidateMessage {
    type: "dt:invalidate";
    scope: ChangeScope;
    pages?: true;
}
export declare function invalidateMessage(scope: ChangeScope, opts?: {
    pages?: boolean;
}): InvalidateMessage;
