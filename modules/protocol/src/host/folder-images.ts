// Ported from the dreamteamer VS Code extension's host side (src/folder-images.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs";
import * as path from "node:path";
export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
export function isImageFile(name) {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    return name.includes(".") && IMAGE_EXTS.has(ext);
}
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
