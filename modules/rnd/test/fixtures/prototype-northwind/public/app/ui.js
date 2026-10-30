// The prototype's own element helper — the harness never uses it.
export function el(tag, attrs = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
	for (const c of [].concat(children)) if (c != null) n.append(c instanceof Node ? c : String(c));
	return n;
}
