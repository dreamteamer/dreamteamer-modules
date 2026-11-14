# Setting up wikis

The module ships one setup unit (`dt status` lists it as `wikis`): one check — `qmd` on PATH, the on-device retrieval engine behind `dt-wiki ask` and `dt-wiki index` — and one action, `install-qmd` (`npm install -g @tobilu/qmd`), a machine and network effect the engine runs only under `dt setup wikis --allow machine --allow network` or a y/n in a terminal. Without qmd the line reads `blocked` naming it; everything that greps rather than asks (`search`, `outline`, `incomplete`, `status`, `verify`) needs nothing and still works.
