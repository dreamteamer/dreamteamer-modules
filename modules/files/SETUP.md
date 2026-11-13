# Setting up files

One setup unit (`dt status` lists it as `files`): the input `files_folder` (FILES_FOLDER, required) — the mounted root every `file-drives` record resolves under — written into `.env` by `set-files_folder` (a workspace-files effect). The check reads `configured` when the key is set and the folder exists, `blocked` when it is set but not there (a drive not mounted), `missing` when unset. Nothing downloads, nothing reaches the network; `dt files sync` is the next command once a drive record exists.
