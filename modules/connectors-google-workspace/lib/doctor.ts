// `dt-google doctor`: the original four rows, projected from the one local inspect the setup plan
// and the engine doctor also read (lib/googleSetup.mjs). The report shape and wording are unchanged.
import { legacyDoctor } from "./googleSetup.ts"

export function doctor({ env = process.env, accessible }: Record<string, any> = {}) {
  return legacyDoctor({ env, ...(accessible ? { accessible } : {}) })
}
