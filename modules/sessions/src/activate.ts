// @dreamteamer/sessions — the extension entry: the `session` verb (bind · end · send), the sessions a
// record was worked on in `dt next`, and the retired session-bindings kind (./sessions/). Until core
// 0.12.0 this code shipped inside core, merged with the files entry; it is the whole entry here.
import type { Contribution } from "dreamteamer"
import { activateSessions, type Api } from "./sessions/index.ts"

export const apiVersion = 1

export default function activate(api: Api): Contribution {
  return activateSessions(api)
}
