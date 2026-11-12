---
name: using-google-workspace
description: "Use when reading or acting on Google Workspace through the local workspace-mcp bridge, selecting among Google accounts, or diagnosing local account authorization."
---

# Google Workspace through local MCP

Run `npx dt-google doctor --json` before initial use. It checks local prerequisites without opening a browser, reading token contents or making a network request. Complete the module README's owner-controlled setup if missing. Account authorization is not established by a green doctor.

Select the intended Google account from the user's private configuration or ask when ambiguous. Never infer the account from whichever token is available. Call:

```sh
npx dt-google call dana@northwind.example search_gmail_messages '{"query":"newer_than:1d"}'
```

Use the pinned server's actual tool schema. The bridge requires an explicit email and rejects any conflicting `user_google_email` argument. It does not start an authorization attempt without an existing account credential. Expired credentials or authorization prompts are a stop to finish consent with the owner, not a reason to retry in a loop.

Only the bridge's exact read allowlist runs by default. Obtain approval for the concrete action before adding `--allow-write`; a flag is not user approval. Never copy OAuth client secrets or tokens into Git, published prompts or logs. Keep account results private; do not forward data to another workspace or recipient without the applicable authorization.

This module is distinct from meetings ingestion: configure the meetings module's calendars, local files and transcription capabilities independently. Do not infer recording access from a successful Gmail read.
