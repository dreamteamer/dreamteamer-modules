// rnd's engine extension — notebooklm's, composed into src/, plus what rnd itself contributes.
//
// The composed src/ is a copy of the notebooklm module's (compose.json). rnd's own entry lives here, outside
// src/, named by compose.json `extension`; it activates the origin's entry untouched (compose refuses an own
// entry that does not import it) and adds one contribution, `check`, made of three rules a descriptor cannot say:
//   releases     one release per product, package and version (lib/releases.mjs)
//   stage tags   a change request tagged `deployed` without `deployed_on`, or the reverse — a WARNING
//                (lib/stage-tags.mjs)
//   stage        a change request whose `stage` is not the gate `dt next` names on it, or contradicts its
//                own status, dates and links — a WARNING (lib/cr-stage.mjs)
import activateNotebooklm, { apiVersion } from '../src/extension.js';
import { checkReleases } from './releases.mjs';
import { checkStageTags } from './stage-tags.mjs';
import { checkChangeRequestStage } from './cr-stage.mjs';

export { apiVersion };

export default function activate(dt) {
	return {
		...activateNotebooklm(dt),
		check: async (ctx) => {
			const c = { ...ctx, dt: ctx.dt ?? dt };
			return [...((await checkReleases(c)) ?? []), ...((await checkStageTags(c)) ?? []), ...((await checkChangeRequestStage(c)) ?? [])];
		},
	};
}
