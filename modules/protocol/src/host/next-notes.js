// Ported from the dreamteamer VS Code extension's host side (src/next-notes.ts); PROTOCOL.md is the contract it answers.
import { engine } from "./engine.js";
import { refsIn } from "./note-refs.js";
export function notesFor(store, collection, ids) {
    const eng = engine();
    if (!ids.length || typeof eng.contributedNotes !== "function")
        return [];
    let raw;
    try {
        raw = eng.contributedNotes(eng.ws, collection, ids) ?? [];
    }
    catch {
        return [];
    }
    const collections = [...store.descriptors.keys()];
    const known = new Map();
    const exists = (c, id) => {
        const key = `${c}/${id}`;
        if (!known.has(key)) {
            let ok = false;
            try {
                store.read(c, id);
                ok = true;
            }
            catch { }
            known.set(key, ok);
        }
        return known.get(key);
    };
    return raw.map((n) => ({ ...n, refs: refsIn(n.text, collections).map((r) => ({ ...r, exists: exists(r.collection, r.id) })) }));
}
export function byId(notes) {
    const out = new Map();
    for (const n of notes) {
        if (n.id == null)
            continue;
        if (!out.has(n.id))
            out.set(n.id, []);
        out.get(n.id).push(n);
    }
    return out;
}
