# Setting up search

The module ships one setup unit (`dt status` lists it as `search`): one check — `qmd` on PATH, the on-device index every search runs on — and one action, `install-qmd` (`npm install -g @tobilu/qmd`), a machine and network effect the engine runs only under `dt setup search --allow machine --allow network` or a y/n in a terminal. Without qmd the line reads `blocked` naming it; everything that greps rather than asks still works.
