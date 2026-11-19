// @dreamteamer/proofs — the engine extension entry.
//
// Loaded because the workspace depends on this package (or carries it under modules/); `activate(dt)`
// receives the running engine's public API, and every engine call in this package goes through it
// (src/engine.js). The same package.json key makes this package a content module, so compile also
// discovers `collections/proofs.collection.yaml` and the `proving-artifacts` skill.
import type { Contribution } from "dreamteamer"
import { bind, dt, type Api } from "./engine.ts"
import { proveCommand, PROVE_USAGE } from "./prove.ts"
import { analyze } from "./analyze.ts"

export const apiVersion = 1

export default function activate(api: Api): Contribution {
  bind(api)
  return {
    commands: {
      // the exit code is the answer: 0 pass · 1 fail · 3 unavailable · 4 no-fixture · 5 pending · 6 vacuous
      prove: {
        usage: PROVE_USAGE,
        run: (ws, argv) => {
          dt.warnIfStale(ws.root)
          return proveCommand(ws, argv).code
        },
      },
    },
    // `proofs/fixtures/` holds RECORDS a fixture proof runs against, not proofs
    sourceKinds: [{ kind: "proofs", exclude: ["fixtures"] }],
    analyze,
    orientation: "before saying an artifact works, run `dt prove <artifact>` and quote its result.",
  }
}
