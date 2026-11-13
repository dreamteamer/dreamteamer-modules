// @dreamteamer/core — the engine extension entry (API 1): the module's setup unit, and nothing
// else. The calendar sync itself is the fetching-meetings skill; this is how `dt install`, `dt setup`
// and `dt status` learn which calendars count as work, through the one contract every module speaks.
import { SETUP_UNIT } from './meetings-setup.mjs';

export const apiVersion = 1;

export default function activate() {
	return { setup: [SETUP_UNIT] };
}
