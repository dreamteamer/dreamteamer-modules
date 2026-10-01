# dreamteamer-modules

The official [dreamteamer](https://www.npmjs.com/package/dreamteamer) modules. Each one is its own
npm package, versioned and released on its own, and they all live in this one repo.

**Work: people, commitments, meetings**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/users`](modules/users) | the people work is assigned to | — |
| [`@dreamteamer/assets`](modules/assets) | icons, logos and avatars as file records | — |
| [`@dreamteamer/contacts`](modules/contacts) | people you deal with, and their companies | assets |
| [`@dreamteamer/tasks`](modules/tasks) | who owes what by when: inbox, board, by person | users |
| [`@dreamteamer/meetings`](modules/meetings) | calendar meetings, with a prep, a summary and a critique | contacts · tasks · users |
| [`@dreamteamer/recordings`](modules/recordings) | recordings matched to their meeting, transcribed offline | meetings |
| [`@dreamteamer/projects`](modules/projects) | the plan: phases, lanes, activities, gates, decisions, risks | users |

**Knowledge and review**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/notebooks`](modules/notebooks) | local wikis you can grep, and NotebookLM notebooks as specs | — |
| [`@dreamteamer/search`](modules/search) | `dt-find`, an effort ladder over the workspace's records | — |
| [`@dreamteamer/notebooklm`](modules/notebooklm) | `dt notebooklm`, the workspace exported for NotebookLM | — |
| [`@dreamteamer/perspective`](modules/perspective) | a person's operating model, read off their own past work | — |
| [`@dreamteamer/rnd`](modules/rnd) | products, design docs, issues, features, research, personas | — |

**Tools that run code**

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/proofs`](modules/proofs) | `dt prove`: behaviour proofs answered by exit code | — |
| [`@dreamteamer/worktrees`](modules/worktrees) | `dt worktree` and `dt land`: a second checkout, and bringing it home | — |
| [`@dreamteamer/http`](modules/http) | `dt serve`: the REST api over the same validating store | — |
| [`@dreamteamer/docker-workspaces`](modules/docker-workspaces) | `dt-docker`: a workspace as a local Docker container | — |
| [`@dreamteamer/setup`](modules/setup) | `dt-setup`: one board for every module above, with the fixes | — |

Install a module **and everything it needs** as direct dependencies, then compile. The engine loads
only the modules your `package.json` names, so a module pulled in indirectly would sit on disk and do
nothing. Each module's README has its exact install line.

```bash
npm install @dreamteamer/tasks @dreamteamer/users
npx dreamteamer compile
```

**Making a module yours** — another label, an extra field — is an overlay in your own module, never
an edit to the installed one. Name the module by its full package name, and quote it, because YAML
reserves a leading `@`:

```yaml
# modules/mine/collections/contacts.collection.yaml   (and "dependencies": ["@dreamteamer/contacts"])
name: contacts
extends: "@dreamteamer/contacts/contacts"
label: Kontakte
schema:
  properties:
    pronouns: { type: string }
```

Nothing here is published yet. Until it is, a workspace can use a module by copying its folder into
its own `modules/`, or preview this whole repo with `npx dt-setup link <clone>`.

## working on this repo

```bash
npm install
npm test                                   # every gate, against the engine in devDependencies
DT_ENGINE_DIR=../dreamteamer npm test      # the same, against an engine checkout
```

`npm test` installs every module into fresh workspaces twice: once from its packed tarball, the way
npm delivers it, and once as a copied folder. It checks each one compiles with only what it declares,
that the modules work together on real records, that every module's own suite passes, and that
nothing private leaked in. The transcription skill's Python tests run separately, against the skill's
own environment:

```bash
uv run --project modules/recordings/skills/transcribing-recordings --with pytest \
  python -m pytest -q modules/recordings/test/transcribing-recordings
```

A release is one tag per module, `<id>-v<version>`, pushed by a person: see `.github/workflows/release.yml`.
