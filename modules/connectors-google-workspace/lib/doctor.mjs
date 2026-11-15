// `dt-google doctor`: the original four rows, projected from the one local inspect the setup plan
// and the engine doctor also read (lib/google-setup.mjs). The report shape and wording are unchanged.
import { legacyDoctor } from './google-setup.mjs';

export function doctor({ env = process.env, accessible } = {}) {
  return legacyDoctor({ env, ...(accessible ? { accessible } : {}) });
}
