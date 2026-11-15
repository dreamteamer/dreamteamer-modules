// rnd's engine extension — one contribution, `check`, made of three rules a descriptor cannot say:
//   releases     one release per product, package and version (lib/releases.mjs)
//   stage tags   a change request tagged `deployed` without `deployed_on`, or the reverse — a WARNING
//                (lib/stage-tags.mjs)
//   stage        a change request whose `stage` is not the gate `dt next` names on it, or contradicts its
//                own status, dates and links — a WARNING (lib/cr-stage.mjs)
// rnd ships no setup unit: wikis and notebooklm are their own packages, with their own entries.
import { checkReleases } from './releases.mjs';
import { checkStageTags } from './stage-tags.mjs';
import { checkChangeRequestStage } from './cr-stage.mjs';

export const apiVersion = 1;

export default function activate(dt) {
	return {
		check: async (ctx) => {
			const c = { ...ctx, dt: ctx.dt ?? dt };
			return [...((await checkReleases(c)) ?? []), ...((await checkStageTags(c)) ?? []), ...((await checkChangeRequestStage(c)) ?? [])];
		},
	};
}
