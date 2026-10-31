// rnd's engine extension — notebooklm's, composed into src/, plus what rnd itself contributes.
//
// The composed src/ is a copy of the notebooklm module's (compose.json); rnd may not add files there. So
// rnd's own entry lives here, OUTSIDE src/, wraps the origin's untouched, and adds one contribution:
//   check   the release rule a descriptor cannot say — one release per product, package and version
//           (lib/releases.mjs)
import activateNotebooklm, { apiVersion } from '../src/extension.js';
import { checkReleases } from './releases.mjs';

export { apiVersion };

export default function activate(dt) {
	return { ...activateNotebooklm(dt), check: (ctx) => checkReleases({ ...ctx, dt: ctx.dt ?? dt }) };
}
