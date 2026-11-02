import { Descriptor } from "./fsdata.js";
export declare function routeKey(route: string): string;
export declare function routePath(route: string): string;
export declare function recordFile(root: string, d: Descriptor, id: string): string | undefined;
export declare function fileForRoute(root: string, route: string): string | undefined;
export declare function titleForRoute(root: string, route: string): string;
export declare function recordTitle(root: string, d: Descriptor, id: string): string;
