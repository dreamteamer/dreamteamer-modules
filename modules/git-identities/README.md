# Git identities

An optional, dependency-free module for planning and checking folder-scoped Git identities.
Install alongside any Dreamteamer workspace, then compile. It ships no records, accounts or keys.

```sh
npm install @dreamteamer/git-identities
npm run compile
```

Three independent concerns:

- **Commit identity:** `user.name` and `user.email`, selected using Git `includeIf` by repository folder.
- **Remote authentication:** SSH host alias and the owner's key, or a separately configured HTTPS credential helper. An email in a commit does not authenticate a GitHub account.
- **AI subscription:** the account used by a coding assistant. This module never changes it or reads its credentials.

A single GitHub user may own private repositories and belong to an organization. That does not
require separate SSH keys. Distinct GitHub accounts normally need distinct keys. Do not copy
another person's keys or machine configuration.

## Private configuration

Create an untracked JSON file outside the workspace, with the owner's selected values. Example
values below are synthetic. Paths may be absolute or begin with `~/`; roots must not overlap.

```json
{
  "identities": [{
    "id": "personal",
    "root": "~/Documents/projects/personal",
    "name": "Dana Oren",
    "email": "dana@northwind.example",
    "host": "github.com",
    "sshAlias": "github-personal",
    "keyPath": "~/.ssh/id_ed25519_personal"
  }]
}
```

Run from anywhere, passing the private configuration and repository explicitly:

```sh
dt-git-identities plan /path/to/private-config.json
dt-git-identities doctor /path/to/private-config.json /path/to/repository
```

Equivalent package invocation: `node node_modules/@dreamteamer/git-identities/bin/git-identities.mjs`.
The explicit paths avoid guessing an identity from the current workspace or a compiled skill directory.

`plan` prints proposed include rules, identity files, SSH host blocks and clone URL patterns. It
**does not apply them**, generate keys, install programs or call a provider. Output contains the
owner's identity values: keep it private, never commit it to a public repository. Before applying
anything, inspect existing configurations, obtain owner approval, back them up and merge only the
intended entries. Never overwrite whole Git/SSH files or change key permissions automatically.

`doctor` calls local Git only and returns booleans rather than identity values. Exit 0 means
commit name/email and the configured origin SSH alias match; 1 means unavailable, unconfigured
or degraded; 2 means invalid input. It does not test authentication, key selection or remote
permissions. Existing local overrides and `insteadOf` rewrites can affect the effective result.
HTTPS remotes are reported as a nonmatching SSH alias, not automatically rewritten.

Use the explicit alias when cloning: `git@github-personal:<owner>/<repository>.git`. Conditional
includes cannot select the key for a destination repository that does not yet exist. No automatic
`insteadOf` rewriting is proposed. Include rules must have a trailing slash for recursive matching.
Use canonical paths for identity roots: symlink spellings can prevent Git include matching.
Linked worktrees may use the primary repository's Git directory; check every actual worktree.

After approved configuration, verify the identity with `git config --show-origin --get user.email`
and inspect `git remote -v` privately. If authorized, test the alias with `ssh -T git@<alias>` and
confirm the account greeting. GitHub may return exit 1 on successful authentication; do not judge
that test by exit code alone. Stop on an unknown host key rather than disabling host verification.

## Tests

`node --test modules/git-identities/test/*.test.mjs` exercises rendering, validation, and actual
Git conditional includes/overrides in isolated temporary homes. No network or real credentials.

Set `GIT_IDENTITIES_CONFIG` to this private JSON file outside Git and `dt status` checks the current
workspace against it through the module's setup unit; it never applies the
plan or writes global Git/SSH configuration.

## 0.2.1 — the setup package is gone (CR-dt-007)

Nothing to do but `dt update @dreamteamer/git-identities`, then `dt compile`. The README says the setup unit and `dt status` check `GIT_IDENTITIES_CONFIG`, where it named `@dreamteamer/setup`.

## 0.2.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/git-identities` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `git-identities` setup unit (`dt setup git-identities`).
