/* player.js — the demo player. A launcher opens the guide: the journeys grouped by actor, with search and a
   coverage badge (steps on built screens / on stubs); a journey lists its steps; "Play" plays it in a caption
   bar (step n/N, actor, sentence, what to look at) with previous · next · autoplay · stop and ←/→/Esc. Each step
   rebuilds or advances the world (playback.js), signs in the step's demo user, navigates to the step's screen
   and spotlights `[data-demo~="<anchor>"]`. Start snapshots the store, the session and the metadata layer; stop
   restores all three. Deep link: `#/<route>?demo=<journey>&step=<n>`.

   player.init(app, options) — `app` is the prototype's object (store, session, screens, byKey, current(),
   onRender(fn), renderAll(); optional mount, initialHash, closeDrawer(), drawerOpen(), ui.toast). The player
   never looks up a global and uses none of the prototype's UI helpers. It sets
   app.demo = { openGuide, play, next, prev, stop, state, coverage }. */
import { h, clear, toast as ownToast } from './dom.js';
import { stateAt, applyStep } from './playback.js';
import * as metaLayer from './meta.js';

const EN = {
  guide: 'Demo guide', guideHint: 'The user journeys, step by step', search: 'Search a journey, a story or a screen', noResults: 'No journey matches',
  steps: 'steps', built: 'built', stub: 'not built', allJourneys: 'All journeys', play: 'Play', playFrom: 'Play from here', trigger: 'Trigger', outcome: 'Outcome',
  acceptance: 'Acceptance', failures: 'Failure paths', open: 'To clarify', system: 'System', systemStep: 'System step', outOfScope: 'Outside this prototype',
  step: 'Step', previous: 'Previous', next: 'Next', autoplay: 'Autoplay', pause: 'Pause', stop: 'Stop', look: 'What to look at: ', copyLink: 'Copy a link to this step',
  copied: 'Link copied — it opens the player at this step', end: 'End of the journey', stopped: 'Demo stopped — the demo data was restored', notFound: 'Journey not found: ',
  noModule: 'No playback module for ', refused: 'Action refused: ', expected: 'The system refused, as the step expects: ', layerOn: 'The metadata layer was switched on for this step',
  missing: '(the step\'s element is not marked on this screen yet)', demoAction: 'Demo action: ',
};

let A = null; let O = null; let D = null; let bar = null; let fab = null; let guide = null; let P = null;
const mods = {};
const tx = (v) => (O?.tx ? O.tx(v) : v == null ? '' : typeof v === 'string' ? v : String(v.en ?? Object.values(v)[0] ?? ''));
const L = (k) => tx(O?.strings?.[k] ?? EN[k]);
const toast = (m, tone) => (A?.ui?.toast ? A.ui.toast(m, tone) : ownToast(m, tone));
const ls = () => { try { return window.localStorage; } catch { return null; } };
const snapKey = () => `${O.storageKey}:demo-snapshot`;

/* ---------------------------------------------------------------- pure helpers (Node imports these) */

/** parse `#/<path>?demo=<key>&step=<n>` → { key, step, rest } or null */
export function parseDeepLink(hash) {
  const s = String(hash || ''); const qi = s.indexOf('?'); if (qi < 0) return null;
  const q = new URLSearchParams(s.slice(qi + 1)); const key = q.get('demo'); if (!key) return null;
  const step = Math.max(1, parseInt(q.get('step') || '1', 10) || 1);
  const rest = new URLSearchParams(s.slice(qi + 1)); rest.delete('demo'); rest.delete('step');
  return { key, step, rest: s.slice(0, qi) + (rest.toString() ? `?${rest}` : '') };
}

/** { built, stub } — steps on built screens versus stubs (an unregistered screen counts as a stub) */
export function coverageOf(j, byKey) {
  const built = j.steps.filter((s) => !s.outOfScope && byKey[s.screen] && !byKey[s.screen].stub).length;
  return { built, stub: j.steps.filter((s) => !s.outOfScope).length - built };
}

/** the journeys of each group that match a search, ordered by `sort` (default: key) */
export function groupJourneys(journeys, groups, q = '', sort = null) {
  const n = String(q || '').trim().toLowerCase();
  const hit = (j) => !n || [j.name, j.key, j.description, ...j.steps.flatMap((s) => [s.sentence, s.caption, s.screen, s.story])].some((x) => x && String(x).toLowerCase().includes(n));
  const by = sort || ((a, b) => String(a.key).localeCompare(String(b.key)));
  return groups.map((g) => ({ ...g, journeys: journeys.filter((j) => j.group === g.key && hit(j)).sort(by) })).filter((g) => g.journeys.length);
}

/** the user a step signs in: the module step's `user`, then `users(persona, step)` (or a map), then `defaultUser[portal]` */
export function resolveUser(step, { users = null, defaultUser = {} } = {}) {
  if (step.user) return step.user;
  const u = typeof users === 'function' ? users(step.persona, step) : users?.[step.persona];
  return u || defaultUser[step.portal] || null;
}

/** the record's step and the module's step as one: WHAT from the record, HOW from the module; a value the
    record leaves empty does not erase the module's */
export function mergeStep(rec = {}, mod = {}) {
  const s = { ...mod, ...Object.fromEntries(Object.entries(rec).filter(([, v]) => v != null)) };
  if (s.anchor === undefined) s.anchor = rec.system ? null : rec.story ?? null;
  return s;
}

/** the next index after `i` that plays (an out-of-scope step is skipped), or -1 */
export function nextPlayable(steps, i, dir = 1) {
  for (let k = i + dir; k >= 0 && k < steps.length; k += dir) if (!steps[k].outOfScope) return k;
  return -1;
}

/** the sentences of every journey step on a screen — what a stub lists */
export function stepsFor(journeys, screenKey) {
  const out = [];
  for (const j of journeys) for (const s of j.steps) if (s.screen === screenKey && s.sentence) out.push({ sentence: s.sentence, story: s.story, journey: j.key });
  return out;
}

/* ---------------------------------------------------------------- the guide */
const screenOf = (key) => A.byKey[key] || null;
const isStub = (key) => { const s = screenOf(key); return !s || !!s.stub; };
export const coverage = (j) => coverageOf(j, A.byKey);
const covPill = (j) => { const c = coverage(j); return h('span', { class: `demo-pill ${c.stub ? 'warn' : 'ok'}` }, [c.stub ? `${c.built} ${L('built')} · ${c.stub} ${L('stub')}` : `${c.built} ${L('built')}`]); };
const personaName = (k) => (k ? D.personas?.[k] ?? k : '');

export function openGuide(view = 'list', key = null) {
  if (!guide) {
    const dlg = h('dialog', { class: 'demo-guide', 'aria-label': L('guide') });
    dlg.addEventListener('close', () => { guide = null; dlg.remove(); });
    (A.mount || document.body).append(dlg);
    guide = { dlg, view, key, q: '' };
  }
  Object.assign(guide, { view, key });
  drawGuide();
  if (!guide.dlg.open) { try { guide.dlg.showModal(); } catch { guide.dlg.setAttribute('open', ''); } }
}
const closeGuide = () => { if (guide?.dlg.open) guide.dlg.close(); else if (guide) { guide.dlg.remove(); guide = null; } };
function drawGuide() {
  if (!guide) return;
  const j = guide.view === 'journey' && D.byKey[guide.key];
  clear(guide.dlg).append(h('button', { type: 'button', class: 'demo-guide-x', 'aria-label': L('stop'), onClick: closeGuide }, ['✕']), j ? journeyView(j) : listView());
}
function listView() {
  const box = h('div', { class: 'demo-groups' });
  const fill = () => {
    clear(box);
    const gs = groupJourneys(D.journeys, D.groups, guide.q, O.sortJourneys);
    for (const g of gs) box.append(h('section', { class: 'demo-group' }, [h('h3', {}, [`${tx(g.label)} · ${g.journeys.length}`]), h('div', { class: 'demo-list' }, g.journeys.map((j) => h('button', { type: 'button', class: 'demo-jrow', 'data-demo': `journey-${j.key}`, onClick: () => { guide.view = 'journey'; guide.key = j.key; drawGuide(); } }, [
      h('span', { class: 'demo-jtext' }, [h('b', {}, [tx(j.name ?? j.key)]), h('small', {}, [`${j.key} · ${j.steps.length} ${L('steps')}`])]),
      ...(O.journeyBadges ? O.journeyBadges(j).map((b) => h('span', { class: 'demo-pill' }, [b])) : []), covPill(j),
    ])))]));
    if (!gs.length) box.append(h('p', { class: 'demo-empty' }, [L('noResults')]));
  };
  const search = h('input', { type: 'search', class: 'demo-search', placeholder: L('search'), value: guide.q, onInput: (e) => { guide.q = e.target.value; fill(); } });
  fill();
  return h('div', {}, [h('h2', {}, [L('guide')]), h('p', { class: 'demo-muted' }, [L('guideHint')]), search, box]);
}
function journeyView(j) {
  const playing = P && P.j.key === j.key;
  return h('div', { class: 'demo-journey' }, [
    h('button', { type: 'button', class: 'demo-link', onClick: () => { guide.view = 'list'; drawGuide(); } }, [L('allJourneys')]),
    h('h2', {}, [tx(j.name ?? j.key)]), j.description ? h('p', {}, [tx(j.description)]) : null,
    h('dl', { class: 'demo-kv' }, [h('dt', {}, [L('trigger')]), h('dd', {}, [tx(j.entry) || '—']), h('dt', {}, [L('outcome')]), h('dd', {}, [tx(j.outcome) || '—'])]),
    h('div', { class: 'demo-acts' }, [h('button', { type: 'button', class: 'demo-btn primary', 'data-demo': 'guide-play', onClick: () => play(j.key, 0) }, [L('play')]), covPill(j)]),
    j.open?.length ? h('div', { class: 'demo-sec' }, [h('h4', {}, [L('open')]), h('p', {}, [j.open.join(' · ')])]) : null,
    h('ol', { class: 'demo-steps' }, j.steps.map((s, i) => h('li', { class: `demo-step${playing && P.i === i ? ' current' : ''}${s.outOfScope ? ' out' : ''}` }, [
      h('div', {}, [s.system ? h('span', { class: 'demo-pill' }, [L('systemStep')]) : null, ' ', h('b', {}, [tx(s.sentence ?? s.caption ?? s.screen)])]),
      s.sentence && s.caption ? h('div', { class: 'demo-muted' }, [tx(s.caption)]) : null,
      h('div', { class: 'demo-muted' }, [personaName(s.persona), ' · ', screenOf(s.screen)?.title ? tx(screenOf(s.screen).title) : s.screen, ' ', s.outOfScope ? h('span', { class: 'demo-pill' }, [L('outOfScope')]) : isStub(s.screen) ? h('span', { class: 'demo-pill warn' }, [L('stub')]) : null, s.rules?.length ? ` · § ${s.rules.join(', ')}` : '']),
      s.outOfScope ? null : h('button', { type: 'button', class: 'demo-btn ghost', onClick: () => play(j.key, i) }, [L('playFrom')]),
    ]))),
    j.acceptance?.length ? h('div', { class: 'demo-sec' }, [h('h4', {}, [L('acceptance')]), h('ul', {}, j.acceptance.map((a) => h('li', {}, [tx(a)])))]) : null,
    j.failures?.length ? h('div', { class: 'demo-sec' }, [h('h4', {}, [L('failures')]), h('ul', {}, j.failures.map((f) => h('li', {}, [tx(f)])))]) : null,
  ]);
}

/* ---------------------------------------------------------------- the player */
async function loadModule(key) {
  if (!mods[key]) mods[key] = (await (O.playback ? O.playback(key) : import(new URL(`${O.playbackBase}${key}.js`, import.meta.url).href))).default;
  return mods[key];
}
const layer = () => O.layer || metaLayer;
const snapshot = () => ({ store: A.store.snapshot(), session: A.session.snapshot ? A.session.snapshot() : undefined, meta: layer().isOn() });
function restoreSnap(snap) {
  A.store.restore(snap.store);
  if (snap.session !== undefined && A.session.restore) A.session.restore(snap.session);
  if (typeof snap.meta === 'boolean' && layer().isOn() !== snap.meta) layer().setOn(snap.meta);
}

/** play(journeyKey, stepIndex = 0) — start, or jump within, the player */
export async function play(key, i = 0, { returnHash } = {}) {
  const j = D.byKey[key]; if (!j) { toast(L('notFound') + key, 'bad'); return false; }
  let mod; try { mod = await loadModule(key); } catch (e) { console.warn('[demo] no playback module', key, e); toast(L('noModule') + key, 'bad'); return false; }
  closeGuide();
  if (!P) {
    P = { snap: O.pendingSnap || snapshot(), returnHash: returnHash ?? location.hash, auto: false, timer: null };
    O.pendingSnap = null;
    try { ls()?.setItem(snapKey(), JSON.stringify(P.snap)); } catch { /* quota or private mode: the in-memory snapshot still restores */ }
    document.documentElement.classList.add('demo-playing'); if (fab) fab.hidden = true;
  }
  const same = P.j?.key === key;
  P.j = j; P.mod = mod; P.steps = j.steps.map((rec, k) => mergeStep(rec, mod.steps[k]));
  let at = Math.max(0, Math.min(i, P.steps.length - 1));
  if (P.steps[at].outOfScope) { const k = nextPlayable(P.steps, at); at = k >= 0 ? k : at; }
  return go(at, { rebuild: !same || at !== (P.i ?? -1) + 1 });
}
function go(i, { rebuild = true } = {}) {
  const step = P.steps[i];
  P.i = i; A.quiet = true;
  let results;
  const opts = { session: A.session, actArgs: O.actArgs, resolveArg: O.resolveArg };
  try { results = rebuild ? stateAt(A.store, { ...P.mod, steps: P.steps }, i, opts).results.filter((r) => r.step === i + 1 || !r.ok) : applyStep(A.store, step, opts); } finally { A.quiet = false; }
  for (const f of results.filter((r) => !r.ok)) { console.warn('[demo] step action refused', P.j.key, i + 1, f.name, f.rule ?? '', tx(f.reason) ?? ''); toast(`${L('refused')}${f.name}${f.reason ? ` — ${tx(f.reason)}` : ''}${f.rule ? ` · ${f.rule}` : ''}`, 'warn'); }
  for (const r of results.filter((x) => x.ok && x.expected)) toast(`${L('expected')}${tx(r.reason) ?? ''}${r.rule ? ` · ${r.rule}` : ''}`, 'info');
  P.results = results; P.scrolled = false; P.moving = false;
  A.closeDrawer?.();
  signIn(step);
  O.beforeStep?.(step, A);
  if (screenOf(step.screen)?.meta && !layer().isOn()) { layer().setOn(true); toast(L('layerOn'), 'info'); }
  const hash = hashFor(step);
  if (location.hash !== hash) location.hash = hash; else A.renderAll();
  drawBar(); schedule();
  if (guide) drawGuide();
  return true;
}
function signIn(step) {
  const id = resolveUser(step, O); if (!id) return;
  const portal = step.portal; const u = A.store.user?.(id);
  if (u?.portal && u.portal !== portal) { A.session.set(u.portal, id); if (portal && !A.session.user?.(portal) && O.defaultUser?.[portal]) A.session.set(portal, O.defaultUser[portal]); return; }
  A.session.set(portal ?? u?.portal, id);
}
function hashFor(step) {
  const s = screenOf(step.screen); if (!s) return '#/';
  const q = { ...(step.query || {}) }; if (!q.id && s.sample?.id && !Object.keys(q).length) q.id = s.sample.id;
  const qs = new URLSearchParams(q).toString();
  return `#${s.route}${qs ? `?${qs}` : ''}`;
}
const byAnchor = (a) => document.querySelector(`[data-demo~="${CSS.escape(a)}"]`);
function highlight(n) { document.querySelectorAll('.demo-highlight').forEach((x) => { if (x !== n) x.classList.remove('demo-highlight'); }); n?.classList.add('demo-highlight'); return n; }
/** after every render while playing: spotlight the step's anchor (a stub's card when the anchor is not drawn) */
function spotlight() {
  if (!P) return; const step = P.steps[P.i];
  if (A.current()?.screen?.key !== step.screen) return;
  if (A.drawerOpen?.()) A.closeDrawer?.();
  let n = step.anchor ? byAnchor(step.anchor) : null;
  if (!n && isStub(step.screen)) n = byAnchor(`stub-${step.screen}`);
  /* an anchor the metadata layer hides (inside .meta-only, or not visible with the layer off): switch the layer on */
  if (n && !layer().isOn() && (n.closest('.meta-only') || (n.checkVisibility && !n.checkVisibility()))) { layer().setOn(true); toast(L('layerOn'), 'info'); A.renderAll(); return; }
  highlight(n);
  const miss = bar?.querySelector('.demo-miss'); if (miss) miss.hidden = !!n || !step.anchor;
  /* reveal once per step, and again when a later render drew the anchor anew outside the band */
  if (n && (!P.scrolled || (!P.moving && !inBand(n)))) { P.scrolled = true; P.moving = true; requestAnimationFrame(() => reveal()); }
}
/** the band the spotlight must land in: below a sticky top bar, above the caption bar */
export function visibleBand() {
  const tb = document.getElementById('topbar');
  const top = tb && /sticky|fixed/.test(getComputedStyle(tb).position) ? Math.max(0, tb.getBoundingClientRect().bottom) : 0;
  const bottom = Math.min(window.innerHeight, bar && !bar.hidden ? bar.getBoundingClientRect().top : window.innerHeight);
  return { top, bottom };
}
function inBand(n) {
  const { top, bottom } = visibleBand(); const r = n.getBoundingClientRect();
  return r.top >= top - 2 && (r.bottom <= bottom + 2 || r.height > bottom - top);
}
/** scroll the spotlit element into the band — the one spotlit NOW, so a render that redrew the screen between
    the spotlight and this frame (a hash change landing late) is followed, never a detached node */
function reveal(attempt = 0) {
  if (!P) return;
  const n = document.querySelector('.demo-highlight');
  if (!n) { P.moving = false; return; }
  for (let p = n.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX) || (p.scrollHeight <= p.clientHeight && p.scrollWidth <= p.clientWidth)) continue;
    const pr = p.getBoundingClientRect(); const r = n.getBoundingClientRect();
    if (r.top < pr.top || r.bottom > pr.bottom) p.scrollTop += r.top - pr.top - Math.max(0, (p.clientHeight - r.height) / 2);
  }
  const { top, bottom } = visibleBand();
  const r = n.getBoundingClientRect(); const room = bottom - top;
  const want = r.height <= room + 1 ? top + (room - r.height) / 2 : top + 12;
  const dy = r.top - want;
  /* 'instant': a prototype's `scroll-behavior: smooth` must not leave the scroll half done when the next render lands */
  if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: 'instant' });
  /* the anchor may still grow or move (a late render, a font); look again, a few times, before calling it settled */
  const me = P;
  setTimeout(() => requestAnimationFrame(() => {
    if (P !== me) return;
    const m = document.querySelector('.demo-highlight');
    if (m && !inBand(m) && attempt < 3) reveal(attempt + 1); else P.moving = false;
  }), 120);
}
export function next() {
  if (!P) return;
  const k = nextPlayable(P.steps, P.i);
  if (k >= 0) go(k, { rebuild: k !== P.i + 1 }); else { setAuto(false); toast(L('end'), 'ok'); }
}
export function prev() { if (!P) return; const k = nextPlayable(P.steps, P.i, -1); if (k >= 0) go(k); }
function setAuto(on) { if (!P) return; P.auto = on; schedule(); drawBar(); }
function schedule() { if (!P) return; clearTimeout(P.timer); P.timer = null; if (P.auto) P.timer = setTimeout(() => { if (!P) return; if (nextPlayable(P.steps, P.i) < 0) setAuto(false); else next(); }, O.autoMs); }
/** stop — restore the world, the session and the layer as they were, and return to where the player was opened */
export function stop() {
  if (!P) return; clearTimeout(P.timer); const { snap, returnHash } = P; P = null;
  highlight(null); bar.hidden = true; clear(bar); if (fab) fab.hidden = false;
  document.documentElement.classList.remove('demo-playing'); document.documentElement.style.removeProperty('--demo-bar-h');
  restoreSnap(snap);
  try { ls()?.removeItem(snapKey()); } catch { /* ignore */ }
  if (returnHash != null && location.hash !== returnHash) location.hash = returnHash; else A.renderAll();
  toast(L('stopped'), 'info');
}
function drawBar() {
  if (!P) return;
  const step = P.steps[P.i]; const N = P.steps.length; const sc = screenOf(step.screen);
  const rtl = document.documentElement.dir === 'rtl';
  const user = A.store.user?.(resolveUser(step, O));
  clear(bar); bar.hidden = false;
  bar.append(
    h('div', { class: 'demo-bar-top' }, [
      h('span', { class: 'demo-bar-n', 'data-demo': 'player-step' }, [`${L('step')} ${P.i + 1}/${N}`]),
      h('button', { type: 'button', class: 'demo-bar-j', onClick: () => openGuide('journey', P.j.key) }, [tx(P.j.name ?? P.j.key)]),
      h('span', { class: 'demo-grow' }),
      isStub(step.screen) ? h('span', { class: 'demo-pill warn' }, [L('stub')]) : null,
      h('button', { type: 'button', class: 'demo-icon', title: L('copyLink'), 'aria-label': L('copyLink'), onClick: copyLink }, ['⧉']),
      h('button', { type: 'button', class: 'demo-icon', title: L('stop'), 'aria-label': L('stop'), onClick: stop }, ['✕']),
    ]),
    h('div', { class: 'demo-bar-progress', 'aria-hidden': 'true' }, [h('span', { style: { inlineSize: `${((P.i + 1) / N) * 100}%` } })]),
    h('div', { class: 'demo-bar-who' }, [step.system ? L('system') : personaName(step.persona), user?.name ? ` · ${tx(user.name)}` : '', ' · ', sc ? tx(sc.title ?? sc.key) : step.screen]),
    h('div', { class: 'demo-bar-sentence', 'data-demo': 'player-sentence' }, [tx(step.sentence ?? step.caption ?? '')]),
    h('div', { class: 'demo-bar-look' }, [
      step.caption ? [h('b', {}, [L('look')]), tx(step.caption)] : null,
      h('span', { class: 'demo-miss', hidden: true }, [' ', L('missing')]),
      P.results?.some((r) => r.ok) ? h('span', { class: 'demo-muted meta-only' }, [' · ', L('demoAction'), h('code', {}, [P.results.filter((r) => r.ok).map((r) => r.name).join(', ')])]) : null,
    ]),
    h('div', { class: 'demo-bar-ctl' }, [
      h('button', { type: 'button', class: 'demo-btn', 'data-demo': 'player-prev', disabled: nextPlayable(P.steps, P.i, -1) < 0, title: rtl ? '→' : '←', onClick: prev }, [L('previous')]),
      h('button', { type: 'button', class: 'demo-btn primary', 'data-demo': 'player-next', disabled: nextPlayable(P.steps, P.i) < 0, title: rtl ? '←' : '→', onClick: next }, [L('next')]),
      h('button', { type: 'button', class: 'demo-btn ghost', 'data-demo': 'player-auto', onClick: () => setAuto(!P.auto) }, [P.auto ? L('pause') : `${L('autoplay')} (${Math.round(O.autoMs / 1000)}s)`]),
      h('button', { type: 'button', class: 'demo-btn ghost', 'data-demo': 'player-stop', onClick: stop }, [L('stop')]),
    ]),
  );
  document.documentElement.style.setProperty('--demo-bar-h', `${bar.offsetHeight}px`);
  spotlight();
}
function copyLink() {
  const step = P.steps[P.i]; const s = screenOf(step.screen);
  const url = `${location.origin}${location.pathname}#${s?.route ?? '/'}?demo=${P.j.key}&step=${P.i + 1}`;
  try { navigator.clipboard.writeText(url).then(() => toast(L('copied'), 'ok'), () => toast(url, 'info')); } catch { toast(url, 'info'); }
}
function onKey(e) {
  if (!P || guide || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const rtl = document.documentElement.dir === 'rtl';
  if (e.key === 'Escape') { e.preventDefault(); stop(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); if (rtl) next(); else prev(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); if (rtl) prev(); else next(); }
}

/** init(app, { data, storageKey, playbackBase | playback(key), users, defaultUser, tx, strings, autoMs, beforeStep,
    actArgs, resolveArg, journeyBadges, sortJourneys, layer, launcher }) */
export function init(app, options = {}) {
  A = app;
  O = { storageKey: 'prototype', playbackBase: '../app/demo/journeys/', autoMs: 3000, defaultUser: {}, launcher: true, ...options };
  const data = O.data || {};
  D = { journeys: data.journeys ?? [], groups: data.groups ?? [], personas: data.personas ?? {}, stories: data.stories ?? {} };
  D.byKey = Object.fromEntries(D.journeys.map((j) => [j.key, j]));
  const mount = A.mount || document.getElementById('demo-root') || document.body;
  bar = h('div', { class: 'demo-bar', role: 'region', 'aria-label': L('guide'), hidden: true });
  if (O.launcher) { fab = h('button', { type: 'button', class: 'demo-fab', 'data-demo': 'demo-guide', title: L('guideHint'), onClick: () => openGuide() }, ['▶ ', L('guide')]); mount.append(fab); }
  mount.append(bar);
  A.onRender(() => { if (P) spotlight(); });
  window.addEventListener('harness:overlay', () => { if (P) spotlight(); });
  window.addEventListener('keydown', onKey, true);
  const link = parseDeepLink(A.initialHash ?? location.hash);
  let stale = null; try { stale = JSON.parse(ls()?.getItem(snapKey()) || 'null'); } catch { stale = null; }
  if (stale && link && D.byKey[link.key]) O.pendingSnap = stale;
  else if (stale) { restoreSnap(stale); try { ls()?.removeItem(snapKey()); } catch { /* ignore */ } }
  A.demo = { openGuide, play, next, prev, stop, coverage, visibleBand, stepsFor: (screenKey) => stepsFor(D.journeys, screenKey),
    state: () => (P ? { journey: P.j.key, step: P.i + 1, of: P.steps.length, auto: P.auto, settled: !P.moving, results: P.results, outOfScope: !!P.steps[P.i].outOfScope } : null) };
  if (link && D.byKey[link.key]) play(link.key, link.step - 1, { returnHash: link.rest });
  else if (link) toast(L('notFound') + link.key, 'warn');
  return A.demo;
}
