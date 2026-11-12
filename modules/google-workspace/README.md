# Google Workspace

An optional, local bridge to the public `workspace-mcp` Python server. It does not include an account, OAuth client, cloud service, credential, folder identifier or personal data.

```sh
npm install @dreamteamer/google-workspace
npx dreamteamer compile
npx dt-google doctor --json
```

## Configure on each computer

1. Install `uv` using its official instructions after approval. The bridge starts `uvx --with python-dotenv==1.2.3 workspace-mcp==2.4.2 --transport stdio --tools gmail drive calendar --read-only` for default reads; the first invocation may download that pinned public package. No server is started by compile or doctor. The child process receives only a small OS runtime environment, the two selected local credential paths and fixed local OAuth settings. Inherited cloud credential backends, service accounts, proxies, remote callbacks and runtime injection settings are not forwarded. Automatic uv configuration discovery and upstream dotenv loading are disabled. The dotenv dependency is pinned to 1.2.3, whose disabled flag is required for this boundary.
2. Use a Google **Desktop OAuth client** configured for the services required. Keep its client configuration file outside Git. Set `GOOGLE_CLIENT_SECRET_PATH` to its absolute path and `WORKSPACE_MCP_CREDENTIALS_DIR` to an absolute, local credential directory outside the workspace and outside synced folders. Restrict filesystem access to the account owner. Do not copy another person's credential store.
3. Run `npx dt-google auth ACCOUNT_EMAIL` for each account. It requests one Google consent URL, never opens a browser itself, waits up to nine minutes and verifies one Drive read after the credential appears. The account owner must inspect the consent screen and approve scopes; do not bypass warnings automatically. Custom inherited scope settings are not forwarded: this bridge explicitly restricts the pinned server to Gmail, Drive and Calendar in read-only mode. Inspect the actual requested scopes before consenting; if they exceed your needs, stop rather than approve. A narrower configurable scope policy is not implemented. The bridge also enables the server's read-only mode for default calls. This does **not** revoke previously granted Google OAuth scopes or constrain another program using the same tokens.
4. Verify the app's audience, test-user list, publishing/verification status and Workspace administrator policy. A shared Desktop client may avoid creating a new Cloud project, but the app owner controls client availability. Project ownership alone does not expose the user's locally held access tokens. Shared computers, synced token directories or a remote callback change that conclusion. Testing-mode refresh-token expiry may require reauthorization.
5. Store the account-to-purpose mapping privately. Pass an account explicitly on every call. Configure local inbox and files paths separately for the meetings modules. This module does not copy CRM records, configure calendars for other modules, or install transcription dependencies.

```sh
npx dt-google call dana@northwind.example search_gmail_messages '{"query":"newer_than:1d"}'
```

The response is private account data printed to the caller. Do not put output in public logs, commits or CI artifacts. No credential values or server diagnostics are printed. A stored credential file is only a prerequisite, not proof of current authorization; failures exit nonzero. Consent is a separate owner action. Do not repeatedly retry authentication failures.

## Reading and writing

The default tool allowlist is intentionally narrow and exact: Gmail search/content, calendar lists/events, Drive search/content. Unknown tools are denied, even if their name sounds read-only. `npx dt-google tools` returns available read-tool schemas with pagination; `tools --allow-write` also discovers other tools without executing them. Tool schemas and required arguments belong to the pinned server; unsupported arguments fail rather than falling back to a different account or operation.

For any operation outside this list, first obtain the action-specific approval your assistant requires, then use `--allow-write` as the final argument. This flag permits dispatch; it is **not consent**, does not choose recipients, and does not authorize a transaction. No commands modify or clear token stores. An explicit account cannot be overridden inside tool arguments.

The module provides a local manual-consent flow, not an embedded OAuth UI. The current MCP bridge supports macOS and Linux only; all Windows MCP launches, including reads and discovery, fail before starting the server because its no-browser boundary is not verified there. Direct API helpers never launch MCP or a browser but have not received target-Windows acceptance testing. This is a pilot limitation, not full Windows onboarding support. `npx dt-google whoami` lists stored account filenames without reading tokens and labels every account unverified; it does not prove access. Existing credentials are not deleted or overwritten by `auth`. For a **new credential only**, owner-approved `auth ACCOUNT_EMAIL --allow-write` omits server read-only mode and uses upstream full scopes for those same three services; it does not select an exact per-action scope set. With an existing credential this flag fails explicitly: broadening existing grants is not implemented. Arrange owner-controlled reauthorization separately, or select a new dedicated local credential directory outside Git; never delete or overwrite the existing store automatically. The owner must inspect the Google consent screen. Owner setup and a live account read must be verified on the target computer before calling onboarding complete. Offline tests use a synthetic server and do not prove OAuth, Gmail, Drive or Calendar access.


## Structured Calendar

```sh
npx dt-google-calendar calendars dana@northwind.example
npx dt-google-calendar events dana@northwind.example primary 2026-01-01T00:00:00Z 2026-02-01T00:00:00Z --show-deleted --time-zone UTC
npx dt-google-calendar event dana@northwind.example primary synthetic-event
```

These commands read the direct Google Calendar API using the selected account's stored credential. They return complete JSON fields rather than formatted prose, paginate to the end, preserve cancellation status, access roles and resource attendees, and make no writes to the credential store. No personal timezone is assumed. Token refresh goes only to Google's fixed OAuth endpoint and redirects are refused.

## Drive files and local storage

```sh
npx dt-google-drive ls SYNTHETIC_ROOT --as dana@northwind.example
npx dt-google-drive write SYNTHETIC_ROOT/reports/example.txt /tmp/example.txt --as dana@northwind.example
npx dt-google-drive check-mount SYNTHETIC_ROOT /tmp/local-files --as dana@northwind.example
```

A reference is an explicit root folder ID plus a relative path, never a built-in personal root. Every invocation requires `--as`; there is no fallback to whichever account happens to exist. Commands include `ls`, `exists`, `read`, `write`, `trash`, `rm`, `mv`, `rename`, `cp`, `check-mount` and `tier`. Use `--help` for their shape.

Mutations default to dry-run. Review the concrete source, destination and result before `--apply`, and obtain the action-specific approval required by your assistant. Permanent deletion additionally requires `--permanent`; prefer recoverable trash. Flags do not replace consent. Native document pointers and cloud placeholders are not uploaded as binary content. Downloads require an explicit absolute destination and do not overwrite different or unverified local content.

`tier LOCAL_DIRECTORY ROOT_ID --as ACCOUNT` plans file upload into date-based subfolders; `--layout flat` disables that layout. Local files are kept unless `--apply --delete-local` is explicitly approved. Deletion requires an upload checksum match and a second check that the local bytes have not changed. No Drive IDs, mount paths, accounts or credentials ship in this package.


### Safety-oriented differences

Downloads use an explicit destination rather than a hidden cache. Folder copies and mount checks traverse recursively, rejecting duplicate names and cycles; partial copy results are reported on failure. Native document exports are not implemented, and permanent deletion of native documents or folders is refused. A move names a destination folder; use rename separately to change a name. Mount checks report native documents as unverified rather than claiming that a local shortcut proves cloud content parity. Tiering keeps local files by default rather than deleting them after upload. No command clears OAuth state or credentials automatically.


### Pilot OAuth scope boundary

Every MCP launch explicitly selects only `gmail drive calendar`, including discovery and owner-approved write mode. Other Google services are unsupported until a separate opt-in design is reviewed; `--allow-write` does not enable additional services.

In pinned upstream 2.4.2, new default read-only authorization requests exactly these scopes (Google may display grouped labels):

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/calendar.readonly`

The three identity scopes are not document read scopes. Existing credentials can still carry broader prior grants; dispatch restrictions do not revoke them. New-account `auth --allow-write` additionally requests upstream `gmail.send`, `gmail.compose`, `gmail.modify`, `gmail.labels`, `gmail.settings.basic`, `drive`, `drive.file`, `calendar`, and `calendar.events` (each prefixed `https://www.googleapis.com/auth/`). These are broad service permissions, not permission for one action. Inspect and approve the actual consent screen separately; no live grant has been verified by offline tests.
