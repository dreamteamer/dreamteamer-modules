import { Descriptor } from "./fsdata.js";
/**
 * Identity of a route for tab de-duplication: the path, plus its `filter` — the rest of the query (a
 * layout tweak, a search, a field picked) doesn't count. ⚠ The filter does, because it is what makes
 * two nav rows different places: each record-layer row opens `/content/<c>?filter=<$source is it>`,
 * and with the path alone a click on the second layer's row found the first layer's tab already
 * "showing" it and only revealed it, so the browse never changed (operator 2026-10-29).
 */
export declare function routeKey(route: string): string;
/** The PATH of a route, no query, no trailing slash — what a tab is titled by and a reveal resolves.
 *  Not `routeKey`: a filter makes a tab its own place, but it is never part of the tab's name. */
export declare function routePath(route: string): string;
/** The file a record id maps to — computed for conventional storage, so titling never parses a
 *  collection; probed per parent folder for a collection stored under another (fsdata.recordFileFor). */
export declare function recordFile(root: string, d: Descriptor, id: string): string | undefined;
/** Route → the place on disk it shows, for the reveal gestures (reveal.ts). Same grammar as
 *  `titleForRoute`, so a tab that titles itself "Dana Oren" reveals Dana Oren's file. Returns a
 *  FOLDER for collection-level routes, a FILE for a record, and undefined for a route with no
 *  place on disk (a new-record form, an unknown collection). */
export declare function fileForRoute(root: string, route: string): string | undefined;
export declare function titleForRoute(root: string, route: string): string;
/**
 * A record's title as `titleForRoute` gives it for `/content/<collection>/<id>`, for a caller that
 * already holds the descriptor. ⚠ The route form re-reads every descriptor to find it, which is
 * nothing for one tab and was ~15 s of a 17 s Activity page that titles every record its commits
 * touched (measured 2026-10-31 on a workspace with sixteen layers).
 */
export declare function recordTitle(root: string, d: Descriptor, id: string): string;
