/* dom.js — the harness's own element helper and toast, so the player, the metadata layer and the catalogue use
   none of the prototype's UI helpers. Touches `document` only when called. */

/** h(tag, attrs, children) — attrs: `class`, `style` (object), `on<Event>` functions, booleans as presence,
    everything else as an attribute; children: strings, nodes, arrays, null. */
export function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (/^on[A-Z]/.test(k) || /^on[a-z]+$/.test(k)) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  append(n, children);
  return n;
}

export function append(n, children) {
  for (const c of [].concat(children ?? [])) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(n, c);
    else n.append(c instanceof Node ? c : String(c));
  }
  return n;
}

export const clear = (n) => { n.replaceChildren(); return n; };

let toasts = null;
/** a short notice at the bottom of the page; `tone` is info | ok | warn | bad */
export function toast(msg, tone = 'info') {
  if (!toasts || !toasts.isConnected) { toasts = h('div', { class: 'harness-toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toasts); }
  const t = h('div', { class: `harness-toast ${tone}` }, [msg]);
  toasts.append(t);
  setTimeout(() => t.remove(), 3200);
  return t;
}
