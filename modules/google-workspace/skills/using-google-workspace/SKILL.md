---
name: using-google-workspace
description: "Use when reading or acting on Google Workspace through the local workspace-mcp bridge, selecting among Google accounts, or diagnosing local account authorization."
---

# Google Workspace through local MCP

Run `npx dt-google doctor --json` before initial use. It checks local prerequisites without opening a browser, reading token contents or making a network request. If setup is missing, follow the module's `SETUP.md` (`node_modules/@dreamteamer/google-workspace/SETUP.md`): `dt status` prints the `google-workspace` unit's line and its next command, and the sign-in (`dt setup google-workspace --authorize`) is the owner's step. Account authorization is not established by a green doctor.

Select the intended Google account from the user's private configuration or ask when ambiguous. Never infer the account from whichever token is available. Call:

```sh
npx dt-google call dana@northwind.example search_gmail_messages '{"query":"newer_than:1d"}'
```

Use the pinned server's actual tool schema. The bridge requires an explicit email and rejects any conflicting `user_google_email` argument. It does not start an authorization attempt without an existing account credential. Expired credentials or authorization prompts are a stop to finish consent with the owner, not a reason to retry in a loop.

Only the bridge's exact read allowlist runs by default. Obtain approval for the concrete action before adding `--allow-write`; a flag is not user approval. Never copy OAuth client secrets or tokens into Git, published prompts or logs. Keep account results private; do not forward data to another workspace or recipient without the applicable authorization.

This module is distinct from meetings ingestion: configure the meetings module's calendars, local files and transcription capabilities independently. Do not infer recording access from a successful Gmail read.


## Account setup and structured data

Use `npx dt-google whoami` to list stored account handles, not to prove authorization. With owner approval, `npx dt-google auth ACCOUNT` performs one explicit consent attempt and then a verification read. The owner opens the printed Google URL and checks the account/scopes. Do not copy or publish that URL or token stores. An existing credential is never deleted automatically.

For complete Calendar JSON (including cancelled status and attendee resource flags), use `npx dt-google-calendar calendars|events|event`; specify the timezone only when intended. For Drive paths, use `npx dt-google-drive` with explicit root/path and `--as ACCOUNT`. Run mutating commands without `--apply` first to inspect their dry-run result. Permanent removal, remote writes and local deletion need their respective user approval; a successful dry run does not grant it. Mount checks only report drift and never change local data.
