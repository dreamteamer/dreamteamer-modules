// Ported from the dreamteamer VS Code extension's host side (src/module-of.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
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
export function loadRuntimeModules(root, modules) {
    try {
        const doc = yaml.load(fs.readFileSync(path.join(root, ".dreamteamer", "manifest.yaml"), "utf8"));
        return runtimeModules(doc?.entries, modules);
    }
    catch {
        return new Map();
    }
}
