/* catalog.js — the catalogue screen, the landing's coverage cards and the honest stub. Each factory returns a
   screen module in the prototype's own contract ({ key, route, kind, title, render(ctx) }) or an element, so the
   prototype registers and places them like anything else. A stub is a screen module with `stub: true`. */
import { h } from './dom.js';

const tx0 = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v.en ?? Object.values(v)[0] ?? ''));

/** { total, built, stub } over the screens of one portal (or all) */
export function coverage(screens, portalKey = null) {
  const list = screens.filter((s) => s.route && (portalKey == null || s.portal === portalKey));
  const stub = list.filter((s) => s.stub).length;
  return { total: list.length, built: list.length - stub, stub };
}

/** the catalogue: every registered screen with its key, route, kind, built or stub, rule and question counts */
export function catalogScreen({ route = '/screens', key = 'catalog', title = 'Screens', portals = null, tx = tx0, strings = {} } = {}) {
  const L = { key: 'Key', route: 'Route', kind: 'Kind', state: 'State', rules: 'Rules', open: 'Open', built: 'Built', stub: 'Stub', ...strings };
  return {
    key, route, kind: 'static', title, portal: null, meta: true,
    render(ctx) {
      const all = (ctx?.screens ?? []).filter((s) => s.key !== key && s.route);
      const groups = portals ?? [...new Set(all.map((s) => s.portal ?? null))].map((p) => ({ key: p, label: p ?? '—' }));
      return h('section', { class: 'harness-catalog', 'data-demo': 'catalog' }, [
        h('h1', {}, [tx(title)]),
        ...groups.map((g) => {
          const rows = all.filter((s) => (s.portal ?? null) === g.key);
          if (!rows.length) return null;
          const c = coverage(rows);
          return h('div', { class: 'hc-group' }, [
            h('h2', {}, [`${tx(g.label)} · ${c.built}/${c.total}`]),
            h('table', { class: 'hc-table' }, [
              h('thead', {}, [h('tr', {}, [L.key, L.route, L.kind, L.state, L.rules, L.open].map((x) => h('th', {}, [tx(x)])))]),
              h('tbody', {}, rows.map((s) => h('tr', { 'data-screen': s.key }, [
                h('td', {}, [h('code', {}, [s.key])]), h('td', {}, [h('a', { href: `#${s.route}` }, [s.route])]), h('td', {}, [s.kind ?? '']),
                h('td', {}, [h('span', { class: `hc-pill ${s.stub ? 'warn' : 'ok'}` }, [tx(s.stub ? L.stub : L.built)])]),
                h('td', {}, [String((s.prd ?? []).length)]), h('td', {}, [String((s.open ?? []).length)]),
              ]))),
            ]),
          ]);
        }),
      ]);
    },
  };
}

/** one card per portal: built / total, linking to the portal's first screen */
export function landingCoverage(portals, screens, { tx = tx0 } = {}) {
  return h('div', { class: 'harness-landing' }, portals.map((p) => {
    const c = coverage(screens, p.key);
    const first = screens.find((s) => s.portal === p.key && s.route && !s.route.includes(':'));
    return h('a', { class: 'hl-card', href: first ? `#${first.route}` : '#/', 'data-demo': `landing-${p.key}` }, [h('b', {}, [tx(p.label)]), h('span', {}, [`${c.built}/${c.total}`]), h('span', { class: 'hl-bar' }, [h('span', { style: { inlineSize: `${c.total ? Math.round((c.built / c.total) * 100) : 0}%` } })])]);
  }));
}

/** the honest placeholder: route, title, rule ids, and the step sentences of every journey passing through it */
export function stubScreen(screen, ctx, { stories = [], tx = tx0, strings = {} } = {}) {
  const L = { notBuilt: 'Not built yet', rules: 'Rules', steps: 'What happens here', ...strings };
  return h('section', { class: 'harness-stub', 'data-demo': `stub-${screen.key}` }, [
    h('span', { class: 'hs-pill' }, [tx(L.notBuilt)]),
    h('h1', {}, [tx(screen.title ?? screen.key)]),
    h('p', { class: 'hs-route' }, [h('code', {}, [`#${screen.route ?? ''}`]), ' · ', h('code', {}, [screen.key])]),
    screen.prd?.length ? h('div', { class: 'hs-sec' }, [h('h2', {}, [`${tx(L.rules)} (${screen.prd.length})`]), h('p', {}, [screen.prd.join(' · ')])]) : null,
    stories.length ? h('div', { class: 'hs-sec' }, [h('h2', {}, [tx(L.steps)]), h('ol', {}, stories.map((s) => h('li', { 'data-demo': s.story ?? null }, [tx(s.sentence ?? s)])))]) : null,
  ]);
}
