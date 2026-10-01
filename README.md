# dreamteamer-modules

The official [dreamteamer](https://www.npmjs.com/package/dreamteamer) modules. Each one is its own
npm package, versioned and released on its own, and they all live in this one repo.

| module | what it gives a workspace | needs |
|---|---|---|
| [`@dreamteamer/assets`](modules/assets) | icons, logos, avatars as file records | — |
| [`@dreamteamer/users`](modules/users) | the people work is assigned to | — |
| [`@dreamteamer/contacts`](modules/contacts) | people you deal with, and their companies | assets |
| [`@dreamteamer/tasks`](modules/tasks) | who owes what by when: inbox, board, by person | users |
| [`@dreamteamer/meetings`](modules/meetings) | calendar meetings, with a prep, a summary and a critique | contacts · tasks · users |

Install a module **and everything it needs** as direct dependencies, then compile. The engine loads
only the modules your `package.json` names, so a module pulled in indirectly would sit on disk and do
nothing. Each module's README has its exact install line.

```bash
npm install @dreamteamer/tasks @dreamteamer/users
npx dreamteamer compile
```

Nothing here is published yet. Until it is, a workspace can use a module by copying its folder into
its own `modules/`.

## working on this repo

```bash
npm install
npm test                                   # every gate, against the engine in devDependencies
DT_ENGINE_DIR=../dreamteamer npm test      # the same, against an engine checkout
```

`npm test` installs every module into fresh workspaces twice: once from its packed tarball, the way
npm delivers it, and once as a copied folder. It checks each one compiles with only what it declares,
that the modules work together on real records, and that nothing private leaked in.
