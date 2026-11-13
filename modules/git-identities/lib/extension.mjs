// @dreamteamer/git-identities — the engine extension entry (API 1): the module's setup unit, and nothing else.
import { SETUP_UNIT } from './git-identities-setup.mjs';

export const apiVersion = 1;

export default function activate() {
	return { setup: [SETUP_UNIT] };
}
