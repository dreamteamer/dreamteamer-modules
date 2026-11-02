// Ported from the dreamteamer VS Code extension's host side (src/layer-write.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
import { engine, openWorkspaceAt } from "./engine.js";
import { layerCompiles } from "./sources.js";
export async function createInLayer(root, layer, collection, fields, id) {
    const repo = path.posix.join("git_modules", layer);
    const dir = path.join(root, repo);
    if (!fs.existsSync(dir))
        throw new Error(`${layer} is declared but not installed — run \`dreamteamer install\`. Nothing was written.`);
    if (!layerCompiles(root, repo, collection)) {
        throw new Error(`${layer} has no compiled ${collection} — run \`dt compile -w ${layer}\`, then add the record there. Nothing was written.`);
    }
    const ws = await openWorkspaceAt(dir);
    if (path.resolve(ws.root) !== path.resolve(dir)) {
        throw new Error(`could not open ${layer} as a workspace of its own (the engine resolved ${path.relative(root, ws.root) || "this workspace"}) — adding into a layer needs dreamteamer 0.41.0 or later. Nothing was written.`);
    }
    const store = new (engine().Store)(ws);
    return store.add(collection, fields, id === undefined ? {} : { id });
}
