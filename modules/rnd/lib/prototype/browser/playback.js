/* playback.js — the store side of the demo player, with no DOM and no import, so Node can replay every journey.
   A step's world = the journey's fixture (or the latest step `setup` at or before it) + the actions of every
   step from there up to and including it. Moving forward one step applies only that step; jumping or going
   back rebuilds. A step marked `expectRefusal` passes when the store REFUSES — the refusal is what it shows. */

/** the actions of a step as a list (`action` may be one object or an array) */
export const actionsOf = (step) => [].concat(step?.action || []).filter(Boolean);

/** the named fixture a step loads (`setup: 'name'` or `setup: { fixture: 'name' }`), or null */
export const setupOf = (step) => (typeof step?.setup === 'string' ? step.setup : step?.setup?.fixture) || null;

/** run one step as its user → [{ name, ok, refused, rule, reason, expected }]. A step with a `setup` loads that
    fixture first (clearing the session's view state), so one step forward lands where a rebuild does. Each
    action calls store.act(name, { actor, ...args }); `args` may be a function of the store, and the
    prototype's `actArgs(step, action, args, store)` hook, when given, returns the args actually used (an
    organisation per step, a placeholder resolved against the world). A throwing `args` or hook is a refused
    result, never an exception. */
export function applyStep(store, step, { session = null, actArgs = null } = {}) {
  const out = [];
  const fx = setupOf(step);
  if (fx) {
    session?.clearView?.();
    if (store.loadFixture(fx) === false) out.push({ name: `setup:${fx}`, ok: false, refused: true, rule: null, reason: `fixture did not load: ${fx}`, expected: false });
  }
  for (const a of actionsOf(step)) {
    let args;
    try {
      args = typeof a.args === 'function' ? a.args(store) : (a.args || {});
      if (actArgs) args = actArgs(step, a, args, store) || args;
    } catch (e) { out.push({ name: a.name, ok: false, refused: true, rule: null, reason: `the step found no record to act on (${e.message})`, expected: !!step.expectRefusal }); continue; }
    const r = store.act(a.name, { actor: step.user, ...args }) || {};
    const refused = r.ok === false;
    out.push({ name: a.name, ok: step.expectRefusal ? refused : !refused, refused, rule: r.rule || null, reason: r.reason || null, expected: !!step.expectRefusal });
  }
  return out;
}

/** the index the world for step `i` is rebuilt from, and the fixture loaded there */
export function baseOf(mod, i) {
  for (let k = Math.min(i, mod.steps.length - 1); k >= 0; k--) {
    const fx = setupOf(mod.steps[k]);
    if (fx) return { from: k, fixture: fx };
  }
  return { from: 0, fixture: mod.fixture || 'default' };
}

/** rebuild the world for step `i` (0-based): load the base fixture, replay every step from there through i */
export function stateAt(store, mod, i, { session = null, actArgs = null } = {}) {
  const { from, fixture } = baseOf(mod, i);
  session?.clearView?.();
  store.loadFixture(fixture);
  const results = [];
  for (let k = from; k <= i; k++) {
    const step = k === from ? { ...mod.steps[k], setup: null } : mod.steps[k];
    results.push(...applyStep(store, step, { session, actArgs }).map((r) => ({ ...r, step: k + 1 })));
  }
  return { fixture, results, failures: results.filter((r) => !r.ok) };
}
