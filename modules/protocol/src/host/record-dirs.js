import { engine } from "./engine.js";
export function unreadableReason(d, descriptors) {
    const seen = new Set();
    for (let cur = d; cur && !seen.has(cur.name);) {
        seen.add(cur.name);
        const s = engine().descriptor.storageOf(cur);
        if (s.unavailable)
            return s.unavailable;
        const parent = s.under?.collection;
        cur = parent ? descriptors.get(parent) : undefined;
    }
    return null;
}
export function recordDirsOrNone(store, d) {
    return unreadableReason(d, store.descriptors) ? [] : store.recordDirs(d);
}
