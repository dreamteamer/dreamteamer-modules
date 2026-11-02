// WHICH MODULE A COMPILED RECORD CAME FROM — the `$module` an entity of a runtime kind (a collection,
// an agent, a skill, a command, a ui-view, a mixin, a module) carries on the wire, so the Schema tab
// can be narrowed to one module (operator 2026-10-29: a click on a project in the nav showed every
// project's agents and modules).
//
// Read off compile's own provenance rather than restated: `.dreamteamer/manifest.yaml` lists every
// runtime file under `entries`, each with the SOURCE paths it was built from, and the first source
// sits under exactly one module's root — the module record's `path`. An overlay's later sources are
// the overlaying modules; the first is the module that SHIPS it, which is the one it belongs to.
// Not an engine field: the engine never reads it, and the manifest is already the engine's answer.
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
/** The module whose root holds `source` (a workspace-relative path) — the longest root wins. */
export function moduleOfSource(source, modules) {
    let best;
    for (const m of modules) {
        const root = m.path?.replace(/\/+$/, "");
        if (!root || (source !== root && !source.startsWith(root + "/")))
            continue;
        if (!best || root.length > best.len)
            best = { id: m.id, len: root.length };
    }
    return best?.id;
}
/** `entries` of a parsed manifest → runtime-relative file → owning module id. */
export function runtimeModules(entries, modules) {
    const out = new Map();
    for (const [file, entry] of Object.entries(entries ?? {})) {
        const source = entry?.sources?.[0]?.path;
        const id = source ? moduleOfSource(source, modules) : undefined;
        if (id)
            out.set(file, id);
    }
    return out;
}
/**
 * The module of one runtime path (relative to `.dreamteamer/`): its own entry; else, for a
 * folder-shaped record such as a skill, an entry inside it — or inside the record folder holding the
 * path. Never wider than the record's own folder (`<kind>/<name>`): a sibling record's module is
 * not this one's.
 */
export function moduleOfRuntimeFile(rel, map) {
    const exact = map.get(rel);
    if (exact)
        return exact;
    const parts = rel.split("/");
    for (let take = parts.length; take >= 2; take--) {
        const dir = parts.slice(0, take).join("/");
        for (const [file, id] of map)
            if (file.startsWith(dir + "/"))
                return id;
    }
    return undefined;
}
/** Read the manifest once: an empty map when there is none or it cannot be read — no `$module`, no narrowing. */
export function loadRuntimeModules(root, modules) {
    try {
        const doc = yaml.load(fs.readFileSync(path.join(root, ".dreamteamer", "manifest.yaml"), "utf8"));
        return runtimeModules(doc?.entries, modules);
    }
    catch {
        return new Map();
    }
}
