export type ChangeScope = "schema" | "data";
export declare function strongerScope(a: ChangeScope | undefined, b: ChangeScope | undefined): ChangeScope;
export declare function changeScope(root: string, file: string): ChangeScope;
export declare const RECORD_WATCH_GLOB = "{data,state,.dreamteamer,git_modules,modules}/**";
export declare function isWatchedChange(root: string, file: string, underRecordRoot: (file: string) => boolean): boolean;
export interface InvalidateMessage {
    type: "dt:invalidate";
    scope: ChangeScope;
    pages?: true;
}
export declare function invalidateMessage(scope: ChangeScope, opts?: {
    pages?: boolean;
}): InvalidateMessage;
