// A NEW RECORD ADDED INTO A RECORD LAYER (cr-vscode-004) — the create form's chosen target, when it is
// a layer rather than the workspace's write root.
//
// The engine's `add` writes the WRITE root; a layer is another workspace, cloned under `git_modules/`,
// and the CLI adds into it with `dt add <collection> -w <layer>` (0.41.0): the verb runs IN the layer's
// own workspace, against the layer's own compiled schema, and the file lands in the layer's clone,
// where its commit belongs. This is the same act through the public API — the layer opened as itself
// (`openWorkspaceAt`, with the engine's pin), a Store on it, `add`. Nothing here decides anything the
// engine does not: validation, ids, defaults and refusals are the layer's Store's.
//
// Refused before anything is opened when the layer is absent or has not compiled the collection — the
// host's `layerAccess` calls such a layer `read` / `edit` and the target choice does not offer it; this
// is the belt for a URL typed by hand. And refused AFTER opening when the engine handed back any root
// but the clone: an engine older than the pin climbs out of the clone, and would write into the reader.
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
