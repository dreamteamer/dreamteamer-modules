# Google Workspace

An optional, local bridge to the public `workspace-mcp` Python server. It does not include an account, OAuth client, cloud service, credential, folder identifier or personal data.

```sh
npm install @dreamteamer/google-workspace
npx dreamteamer compile
npx dt-google doctor --json
```

## Configure on each computer

1. Install `uv` using its official instructions after approval. The bridge starts `uvx workspace-mcp==2.4.2 --transport stdio --read-only` for default reads; the first invocation may download that pinned public package. No server is started by compile or doctor.
2. Use a Google **Desktop OAuth client** configured for the services required. Keep its client configuration file outside Git. Set `GOOGLE_CLIENT_SECRET_PATH` to its absolute path and `WORKSPACE_MCP_CREDENTIALS_DIR` to an absolute, local credential directory outside the workspace and outside synced folders. Restrict filesystem access to the account owner. Do not copy another person's credential store.
3. Authorize each account using the pinned server's documented local OAuth setup. The account owner must inspect the consent screen and approve scopes; do not bypass warnings automatically. Use the server's documented scope selection before authorization. Start with read-only service scopes where supported. The bridge also enables the server's read-only mode for default calls. This does **not** revoke previously granted Google OAuth scopes or constrain another program using the same tokens.
4. Verify the app's audience, test-user list, publishing/verification status and Workspace administrator policy. A shared Desktop client may avoid creating a new Cloud project, but the app owner controls client availability. Project ownership alone does not expose the user's locally held access tokens. Shared computers, synced token directories or a remote callback change that conclusion. Testing-mode refresh-token expiry may require reauthorization.
5. Store the account-to-purpose mapping privately. Pass an account explicitly on every call. Configure local inbox and files paths separately for the meetings modules. This module does not copy CRM records, configure calendars for other modules, or install transcription dependencies.

```sh
npx dt-google call dana@northwind.example search_gmail_messages '{"query":"newer_than:1d"}'
```

The response is private account data printed to the caller. Do not put output in public logs, commits or CI artifacts. No credential values or server diagnostics are printed. A stored credential file is only a prerequisite, not proof of current authorization; failures exit nonzero. Consent is a separate owner action. Do not repeatedly retry authentication failures.

## Reading and writing

The default tool allowlist is intentionally narrow and exact: Gmail search/content, calendar lists/events, Drive search/content. Unknown tools are denied, even if their name sounds read-only. Tool schemas and required arguments belong to the pinned server; unsupported arguments fail rather than falling back to a different account or operation.

For any operation outside this list, first obtain the action-specific approval your assistant requires, then use `--allow-write` as the final argument. This flag permits dispatch; it is **not consent**, does not choose recipients, and does not authorize a transaction. No commands modify or clear token stores. An explicit account cannot be overridden inside tool arguments.

The module currently provides local transport and safety gates, not an embedded OAuth UI. Owner setup and a live account read must be verified on the target computer before calling onboarding complete. Offline tests use a synthetic server and do not prove OAuth, Gmail, Drive or Calendar access.
