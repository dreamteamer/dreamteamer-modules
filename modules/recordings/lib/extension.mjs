// @dreamteamer/recordings — the engine extension entry (API 1): the module's setup unit, and nothing
// else. Transcription itself is the transcribing-recordings skill; this is how `dt install`, `dt setup`
// and `dt status` provision what it needs on this machine, through the one contract every module speaks.
import { SETUP_UNIT } from './recordings-setup.mjs';

export const apiVersion = 1;

export default function activate() {
	return { setup: [SETUP_UNIT] };
}
