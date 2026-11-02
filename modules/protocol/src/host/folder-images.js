// A FOLDER OF IMAGES A RECORD POINTS AT — the host half of the carousel layout.
//
// A record field can hold a `${env:FILES_FOLDER}/…/screenshots` TEMPLATE (a meeting's captures, a
// reference product's frames). The template is inert data; the engine's `renderTemplate` turns it
// into a path on THIS machine, and this module lists what is in that folder so the webview can draw
// it. Pure fs + strings, so `test/unit/folder-images.test.ts` can pin it without a VS Code window.
//
// ⚠ The webview can only load bytes from a folder inside `localResourceRoots`. So every declared
// variable that renders to an existing directory becomes a resource root (`envRoots`), and the page
// is told `{ name, path, uri }` for each (`window.__DT_VAR_ROOTS__`) — the same shape the file-codec
// roots already use. Nothing here knows a variable's NAME: it is whatever the workspace declared.
import * as fs from "node:fs";
import * as path from "node:path";
/** What an `<img>` can draw — the same gate the file-record views use. */
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
export function isImageFile(name) {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    return name.includes(".") && IMAGE_EXTS.has(ext);
}
/** `f-2` before `f-10`: digit runs compare as numbers, the rest as text. */
export function naturalCompare(a, b) {
    const re = /(\d+)|(\D+)/g;
    const pa = a.match(re) ?? [], pb = b.match(re) ?? [];
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        const x = pa[i], y = pb[i];
        const nx = /^\d/.test(x), ny = /^\d/.test(y);
        if (nx && ny) {
            const d = Number(x) - Number(y);
            if (d)
                return d;
        }
        else {
            const d = x.localeCompare(y);
            if (d)
                return d;
        }
    }
    return pa.length - pb.length;
}
/** The image files in a folder, naturally sorted. A missing or unreadable folder is `[]`, never a throw
 *  — the route says WHY separately, by looking at the folder itself. */
export function listFolderImages(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && isImageFile(e.name) && !e.name.startsWith("."))
            .map((e) => e.name)
            .sort(naturalCompare);
    }
    catch {
        return [];
    }
}
/** Every declared variable that renders to an existing directory. `render` is the engine's
 *  `renderTemplate` bound to this workspace; a variable it cannot render (unset) is skipped, because
 *  an unset variable is not a place the webview can read from. */
export function envRoots(declared, render) {
    const out = [];
    for (const name of declared) {
        let value;
        try {
            value = render(`\${env:${name}}`);
        }
        catch {
            continue;
        }
        if (!value || value.includes("${"))
            continue;
        try {
            if (fs.statSync(value).isDirectory())
                out.push({ name, path: path.resolve(value) });
        }
        catch { }
    }
    return out;
}
