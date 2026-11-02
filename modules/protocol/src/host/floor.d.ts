/** The one escape hatch. Named in the refusal message, because the person who needs it is the
 *  person reading that message. There is no other way past the floor and no silent downgrade. */
export declare const ALLOW_BELOW_FLOOR_SETTING = "dreamteamer.engine.allowBelowFloor";
/** The context key the refused state sets, so `viewsWelcome` can name the actual cause. */
export declare const ENGINE_TOO_OLD_KEY = "dreamteamer.engineTooOld";
export interface Version {
    major: number;
    minor: number;
    patch: number;
    /** kept for reporting only — see `meetsFloor` for why it takes no part in the comparison */
    prerelease: string | null;
}
/**
 * `major.minor.patch`, with any prerelease or build metadata split off rather than ordered.
 *
 * Returns null on anything that is not three numbers — including `undefined`, `"unknown"` and a
 * two-part `"0.19"`. Null is treated as BELOW the floor by `meetsFloor`: an engine whose version
 * cannot be read cannot be shown to satisfy anything, and guessing in the permissive direction is
 * how a floor stops being a floor.
 */
export declare function parseVersion(raw: unknown): Version | null;
/**
 * Is `version` at or above `floor`?
 *
 * ⚠ PRERELEASE TAGS ARE IGNORED, DELIBERATELY, AND THIS IS NOT SEMVER'S OWN RULE. Semver sorts a
 * prerelease BELOW its release (`0.19.0-rc.1 < 0.19.0`), which would refuse a release candidate —
 * the build most likely to be under test the day the floor rises. So the comparison is numeric on
 * the three-part core only: `0.19.0-rc.1` satisfies a `0.19.0` floor.
 */
export declare function meetsFloor(version: unknown, floor: string): boolean;
/** `npm install` spec that satisfies the floor — the remedy the refusal quotes. */
export declare function installSpecFor(floor: string): string;
/**
 * The refusal, in words. One sentence about what is needed, one about what was FOUND (with the
 * resolved path, so a shadowing clone is visible), the remedy, the promise that nothing was
 * written, and the escape hatch by name.
 */
export declare function floorRefusal(o: {
    floor: string;
    version: string | null;
    engineLabel: string;
}): string;
/**
 * Thrown by `initEngine` BEFORE it imports a single engine module, so the message is the floor's
 * and not `Cannot find module`. A distinct class rather than a flag on Error: `activate()` has to
 * tell a refusal from a genuine load failure — they set different context keys, and the welcome
 * text that named the wrong cause once cost a debugging session.
 */
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
/** What the status bar says while the escape hatch is holding the door open. */
export interface BelowFloorNotice {
    floor: string;
    version: string | null;
    engineLabel: string;
}
