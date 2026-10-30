/* meta.js — the prototype's METADATA LAYER, kept off the design. Rule ids, open questions, illustrative values,
   the demo-data notice and the screen's own documentation are prototype furniture: the screens render them as
   small quiet markers, and hovering, focusing or tapping one shows its detail in ONE pane (#meta-pane) — never
   a tooltip per element.

     <html data-metalayer="on|off">          on: markers visible · off: the screen looks exactly as designed
     [data-meta="rules"]  data-ids="A,B"      rule ids → each with its title from the dictionary, or the bare id
     [data-meta="open"]   data-open="<id>"    an open question → question, lean, status
     [data-meta="demo"]                       an illustrative value
     [data-meta="screen"] data-ids, data-open the page's own marker → screen key, route, rules, questions, stories
     [data-meta="notice"]                     the demo-data notice (and the fixture the world was loaded from)
     .meta-only                               shown only with the layer on, no detail

   Until the viewer chooses (the toggle, stored), the layer follows `metaDefault(portal)`. */
import { h, clear } from './dom.js';

const S = {
  storageKey: 'prototype', metaDefault: () => 'on', dictionary: null, context: () => null, tx: (v) => (v == null ? '' : typeof v === 'string' ? v : String(v.en ?? Object.values(v)[0] ?? '')),
  strings: {
    rules: 'Rules', rule: 'A rule in the scope document', open: 'To clarify — open question', openNone: 'An open question', lean: 'Lean: ', status: 'Status: ',
    openFoot: 'What is shown here is not final — it is settled when the question is decided.', demo: 'Illustrative value', demoBody: 'A value invented for the demo — not a real record.',
    notice: 'Demo prototype', noticeBody: 'All data on these screens is demo data. Rules and open questions are small markers — hover one to see it here.', fixture: 'Demo state: ',
    screen: 'This screen', route: 'Route', stories: 'User stories', toggleOn: 'Hide the prototype metadata layer', toggleOff: 'Show the prototype metadata layer', layer: 'Metadata layer',
  },
};
let dict = null; let loading = null; let pane = null; let current = null; let hideTimer = 0; let ready = false;
const root = () => document.documentElement;
const key = () => `${S.storageKey}:meta`;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const L = (k) => S.tx(S.strings[k]);

/** the layer for a portal: the viewer's stored choice wins, else the prototype's default */
export const layerFor = (chosen, portal, metaDefault) => (chosen === 'on' || chosen === 'off' ? chosen : metaDefault(portal) === 'off' ? 'off' : 'on');
/** "A, B" → ['A', 'B'] */
export const ids = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export const isOn = () => root().dataset.metalayer !== 'off';
export function setOn(on) { root().dataset.metalayer = on ? 'on' : 'off'; lsSet(key(), root().dataset.metalayer); if (!on) hide(true); }
/** syncPortal(portal) — call on every render: the viewer's choice wins, else the portal's default */
export function syncPortal(portal) { root().dataset.metalayer = layerFor(lsGet(key()), portal, S.metaDefault); }

const load = () => (dict ? Promise.resolve(dict) : loading || (loading = Promise.resolve(S.dictionary ? S.dictionary() : {}).then((m) => (dict = { rules: m?.rules ?? {}, notes: m?.notes ?? {}, open: m?.open ?? {} })).catch(() => (dict = { rules: {}, notes: {}, open: {} }))));
const head = (glyph, title, tone = '') => h('div', { class: `mp-head${tone ? ` ${tone}` : ''}` }, [h('span', { class: 'mp-glyph', 'aria-hidden': 'true' }, [glyph]), h('b', {}, [title])]);
const ruleRow = (id) => { const r = dict?.rules?.[id] ?? dict?.notes?.[id]; return h('li', { class: 'mp-rule' }, [h('span', { class: 'mp-id' }, [id]), h('div', {}, [r ? h('b', {}, [r.t ?? r.q]) : h('span', { class: 'mp-muted' }, [L('rule')]), r?.b ? h('p', {}, [r.b]) : null])]); };
const openRow = (id) => {
  const q = dict?.open?.[id] ?? dict?.notes?.[id];
  return h('li', { class: 'mp-open' }, [h('span', { class: 'mp-id' }, [id]), h('div', {}, [
    q ? h('b', {}, [q.q]) : h('span', { class: 'mp-muted' }, [L('openNone')]),
    q?.l ? h('p', {}, [h('span', { class: 'mp-k' }, [L('lean')]), q.l]) : null,
    q && q.s && q.s !== 'open' ? h('p', { class: 'mp-k' }, [L('status') + q.s]) : null,
  ])]);
};
function body(t) {
  const kind = t.dataset.meta;
  if (kind === 'rules') { const list = ids(t.dataset.ids); return [head('§', `${L('rules')} (${list.length})`), h('ul', { class: 'mp-list' }, list.map(ruleRow))]; }
  if (kind === 'open') return [head('?', L('open'), 'warn'), h('ul', { class: 'mp-list' }, [openRow(t.dataset.open)]), h('p', { class: 'mp-foot' }, [L('openFoot')])];
  if (kind === 'demo') return [head('≈', L('demo'), 'warn'), h('p', {}, [L('demoBody')])];
  if (kind === 'notice') { const c = S.context() || {}; return [head('◐', L('notice'), 'warn'), h('p', {}, [L('noticeBody')]), c.fixture ? h('p', {}, [h('span', { class: 'mp-k' }, [L('fixture')]), S.tx(c.fixture)]) : null]; }
  if (kind === 'screen') {
    const c = S.context() || {}; const r = ids(t.dataset.ids); const o = ids(t.dataset.open);
    return [
      head('▤', c.title ? S.tx(c.title) : L('screen')),
      h('div', { class: 'mp-kv' }, [h('span', {}, ['rnd/screens']), h('span', { class: 'mp-id' }, [c.key || '—']), h('span', {}, [L('route')]), h('span', { class: 'mp-id' }, [`#${c.route || ''}`])]),
      o.length ? h('div', { class: 'mp-sec' }, [h('h5', {}, [`${L('open')} (${o.length})`]), h('ul', { class: 'mp-list' }, o.map(openRow))]) : null,
      r.length ? h('div', { class: 'mp-sec' }, [h('h5', {}, [`${L('rules')} (${r.length})`]), h('ul', { class: 'mp-list' }, r.map(ruleRow))]) : null,
      c.stories?.length ? h('div', { class: 'mp-sec' }, [h('h5', {}, [`${L('stories')} (${c.stories.length})`]), h('div', { class: 'mp-tags' }, c.stories.map((k) => h('span', { class: 'mp-id' }, [k])))]) : null,
    ];
  }
  return [h('p', {}, [t.getAttribute('aria-label') || ''])];
}
function render(t) {
  if (!pane) return;
  const draw = () => { if (current !== t) return; clear(pane).append(...body(t).filter(Boolean)); };
  current = t; pane.hidden = false; pane.classList.add('on');
  draw(); if (!dict) load().then(draw);
}
function show(t) { clearTimeout(hideTimer); if (!isOn() && t.dataset.meta !== 'notice') return; if (current !== t) render(t); else { pane.hidden = false; pane.classList.add('on'); } }
function hide(now = false) {
  if (!pane) return;
  clearTimeout(hideTimer);
  const go = () => { pane.classList.remove('on'); current = null; hideTimer = setTimeout(() => { if (!current) pane.hidden = true; }, 160); };
  if (now) go(); else hideTimer = setTimeout(go, 280);
}

/** init({ storageKey, metaDefault(portal), dictionary: () => import(meta.js), context: () => ({ key, route, title, stories, fixture }), strings, tx }) */
export function init(options = {}) {
  Object.assign(S, { ...options, strings: { ...S.strings, ...(options.strings || {}) } });
  if (!root().dataset.metalayer) root().dataset.metalayer = layerFor(lsGet(key()), root().dataset.portal, S.metaDefault);
  pane = document.getElementById('meta-pane') || document.body.appendChild(h('aside', { id: 'meta-pane', hidden: true, role: 'note' }));
  if (ready) return; ready = true;
  const fine = matchMedia('(hover: hover)').matches;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    if (pane.contains(e.target)) { clearTimeout(hideTimer); return; }
    const t = e.target.closest?.('[data-meta]'); if (t) show(t); else if (current) hide();
  });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('[data-meta]'); if (t) show(t); else if (current && !pane.contains(e.target)) hide(); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-meta]');
    if (t && (!fine || e.pointerType === 'touch')) { show(t); return; }
    if (!pane.contains(e.target) && !t && current) hide(true);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) hide(true); });
  pane.addEventListener('pointerleave', () => hide());
  load();
}

/** the toggle button; `onChange` re-renders the prototype */
export function toggleButton(onChange) {
  const on = isOn();
  return h('button', { type: 'button', class: 'meta-toggle', 'aria-pressed': String(on), title: L(on ? 'toggleOn' : 'toggleOff'), 'aria-label': L('layer'), 'data-demo': 'meta-toggle', onClick: () => { setOn(!isOn()); onChange?.(); } }, ['§']);
}

/* the markers — each returns an element the screen places where the thing it explains is */
export function markRules(list) { const l = [].concat(list || []).filter(Boolean); if (!l.length) return null; return h('span', { class: 'meta-mark', 'data-meta': 'rules', 'data-ids': l.join(','), tabindex: 0, role: 'note', 'aria-label': `${L('rules')}: ${l.join(', ')}` }, ['§', l.length > 1 ? h('span', { class: 'mm-n' }, [String(l.length)]) : null]); }
export function markOpen(id, label = '?') { return h('span', { class: 'meta-mark warn', 'data-meta': 'open', 'data-open': id, tabindex: 0, role: 'note', 'aria-label': `${L('open')}: ${id}` }, [label]); }
export function markDemo(child) { return h('span', { class: 'meta-demo', 'data-meta': 'demo' }, [child]); }
export function markScreen({ ids: r = [], open = [] } = {}) { return h('span', { class: 'meta-mark', 'data-meta': 'screen', 'data-ids': [].concat(r).join(','), 'data-open': [].concat(open).join(','), tabindex: 0, role: 'note', 'aria-label': L('screen') }, ['▤']); }
export function markNotice(child) { return h('span', { class: 'meta-notice', 'data-meta': 'notice', tabindex: 0 }, [child ?? L('notice')]); }

export default { init, isOn, setOn, syncPortal, toggleButton, markRules, markOpen, markDemo, markScreen, markNotice };
