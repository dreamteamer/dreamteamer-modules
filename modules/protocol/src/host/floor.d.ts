export declare const ALLOW_BELOW_FLOOR_SETTING = "dreamteamer.engine.allowBelowFloor";
export declare const ENGINE_TOO_OLD_KEY = "dreamteamer.engineTooOld";
export interface Version {
    major: number;
    minor: number;
    patch: number;
    prerelease: string | null;
}
export declare function parseVersion(raw: unknown): Version | null;
export declare function meetsFloor(version: unknown, floor: string): boolean;
export declare function installSpecFor(floor: string): string;
export declare function floorRefusal(o: {
    floor: string;
    version: string | null;
    engineLabel: string;
}): string;
export declare class EngineTooOldError extends Error {
    readonly floor: string;
    readonly version: string | null;
    readonly engineLabel: string;
    constructor(o: {
        floor: string;
        version: string | null;
        engineLabel: string;
    });
}
export interface BelowFloorNotice {
    floor: string;
    version: string | null;
    engineLabel: string;
}
