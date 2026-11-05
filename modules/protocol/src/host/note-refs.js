const CONTINUES = /[A-Za-z0-9_\-./]/;
const ID_END = /[\s)]/;
const TRAILING = /[.,;:]+$/;
export function refsIn(text, collections) {
    const names = [...new Set(collections)].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!names.length || !text)
        return [];
    const out = [];
    let i = 0;
    while (i < text.length) {
        if (i > 0 && CONTINUES.test(text[i - 1])) {
            i++;
            continue;
        }
        const name = names.find((n) => text.startsWith(`${n}/`, i));
        if (!name) {
            i++;
            continue;
        }
        const idStart = i + name.length + 1;
        let j = idStart;
        while (j < text.length && !ID_END.test(text[j]))
            j++;
        const id = text.slice(idStart, j).replace(TRAILING, '');
        if (!id) {
            i = idStart;
            continue;
        }
        const end = idStart + id.length;
        out.push({ ref: `${name}/${id}`, collection: name, id, start: i, end });
        i = end;
    }
    return out;
}
