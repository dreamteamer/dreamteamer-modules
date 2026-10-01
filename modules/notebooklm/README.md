# notebooklm — an inline module with an extension entry

What this module does is its `dreamteamer.description` and the `exporting-to-notebooklm` skill. This
file holds only what neither can:

- **Why it is here and not in `node_modules`.** It was extracted from the engine in 0.31.0 as the
  package `@dreamteamer/notebooklm`, which is not published: the module ecosystem is being
  restructured first. Engine 0.31.0 loads an extension from a workspace module
  (`modules/<id>/package.json` declaring `dreamteamer.extension`), so the vault carries the code
  itself. When a published package exists, delete this folder and depend on it. An installed package
  of the same name is shadowed by this folder, so the order of those two steps does not matter.
- **It is a copy.** Nothing syncs with the extracted package's source. A change made here is carried
  back by hand, if ever.
- **Tests.** `npm test` at the vault root runs `tests/*.test.mjs` against the installed engine. Set
  `DT_ENGINE_DIR=<checkout>` to test against an unreleased one. No test reaches the real `notebooklm`
  CLI: every spawn runs with a PATH whose only `notebooklm` is a stub.
