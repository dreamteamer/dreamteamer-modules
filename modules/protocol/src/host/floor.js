// THE MINIMUM ENGINE VERSION — one declaration, four consumers, no bundled constant.
//
// The extension loads whichever engine the WORKSPACE pins (engine.ts), so the skew between "the
// engine this extension was written against" and "the engine this workspace has" is real and
// permanent. There are no tolerant loads: the extension reads the engine only through its public
// API (`src/api.js`, engine 0.31.0), and an engine below the floor either lacks that API or lacks
// verbs this surface calls — a pane of buttons that 404. So this repo refuses, and the refusal
// names the fix.
//
// ⚠ THE FLOOR IS DECLARED IN `package.json` (`dreamteamer.minEngine`) AND NOWHERE ELSE. This module
// holds the comparison, not the number. The four readers:
//
//   1. `engine.ts` at runtime, handed the value out of `context.extension.packageJSON` — the
//      documented channel, so the manifest is never imported into the bundle.
//   2. `scripts/check-engine-contract.mjs`, which already reads the engine's version and now fails
//      `npm run verify` when the engine we develop against is below the floor. "Too old" becomes a
//      CI failure instead of a runtime surprise.
//   3. tier 1 (`test/unit/engine-floor.test.ts`) — the constant is valid semver, and the comparison
//      answers correctly at the boundaries.
//   4. the README / marketplace body, which states the requirement to a stranger.
//
// A second copy of the number is the whole failure this shape avoids: a floor that disagrees with
// itself refuses workspaces for a version nobody declared.
/** The one escape hatch. Named in the refusal message, because the person who needs it is the
 *  person reading that message. There is no other way past the floor and no silent downgrade. */
export const ALLOW_BELOW_FLOOR_SETTING = "dreamteamer.engine.allowBelowFloor";
/** The context key the refused state sets, so `viewsWelcome` can name the actual cause. */
export const ENGINE_TOO_OLD_KEY = "dreamteamer.engineTooOld";
/**
 * `major.minor.patch`, with any prerelease or build metadata split off rather than ordered.
 *
 * Returns null on anything that is not three numbers — including `undefined`, `"unknown"` and a
 * two-part `"0.19"`. Null is treated as BELOW the floor by `meetsFloor`: an engine whose version
 * cannot be read cannot be shown to satisfy anything, and guessing in the permissive direction is
 * how a floor stops being a floor.
 */
export function parseVersion(raw) {
    if (typeof raw !== "string")
        return null;
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?\s*$/.exec(raw);
    if (!m)
        return null;
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}
/**
 * Is `version` at or above `floor`?
 *
 * ⚠ PRERELEASE TAGS ARE IGNORED, DELIBERATELY, AND THIS IS NOT SEMVER'S OWN RULE. Semver sorts a
 * prerelease BELOW its release (`0.19.0-rc.1 < 0.19.0`), which would refuse a release candidate —
 * the build most likely to be under test the day the floor rises. So the comparison is numeric on
 * the three-part core only: `0.19.0-rc.1` satisfies a `0.19.0` floor.
 */
export function meetsFloor(version, floor) {
    const have = parseVersion(version);
    const need = parseVersion(floor);
    if (!have || !need)
        return false;
    if (have.major !== need.major)
        return have.major > need.major;
    if (have.minor !== need.minor)
        return have.minor > need.minor;
    return have.patch >= need.patch;
}
/** `npm install` spec that satisfies the floor — the remedy the refusal quotes. */
export function installSpecFor(floor) {
    const v = parseVersion(floor);
    return v ? `dreamteamer@^${v.major}.${v.minor}` : "dreamteamer@latest";
}
/**
 * The refusal, in words. One sentence about what is needed, one about what was FOUND (with the
 * resolved path, so a shadowing clone is visible), the remedy, the promise that nothing was
 * written, and the escape hatch by name.
 */
export function floorRefusal(o) {
    const found = o.version ? `at ${o.version}` : "at an unreadable version";
    return (`dreamteamer needs engine ${o.floor} or later. ` +
        `This workspace resolves ${o.engineLabel} ${found}. ` +
        `Run \`npm install ${installSpecFor(o.floor)}\` (or update the clone), then Compile and reload. ` +
        `Nothing on disk has been changed. ` +
        `To run below the floor anyway, set \`${ALLOW_BELOW_FLOOR_SETTING}\`.`);
}
/**
 * Thrown by `initEngine` BEFORE it imports a single engine module, so the message is the floor's
 * and not `Cannot find module`. A distinct class rather than a flag on Error: `activate()` has to
 * tell a refusal from a genuine load failure — they set different context keys, and the welcome
 * text that named the wrong cause once cost a debugging session.
 */
export class EngineTooOldError extends Error {
    floor;
    version;
    engineLabel;
    constructor(o) {
        super(floorRefusal(o));
        this.name = "EngineTooOldError";
        this.floor = o.floor;
        this.version = o.version;
        this.engineLabel = o.engineLabel;
    }
}
