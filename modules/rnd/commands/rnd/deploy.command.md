---
name: rnd/deploy
description: put it live — run the deploy recipe, check the result with your own eyes, and stamp deployed_on on the record
argument-hint: <rnd/change-requests/id | rnd/prototypes/id>
---
load the `rnd-deploy` skill. for $ARGUMENTS: name the recipe and its rollback, check the branch is merged, run the deploy, open the URL and run the one path the change is about, then set `deployed_on` (or refresh the prototype's `live_url`), write the dated section, tell the asker, commit by id. a change request becomes `implemented` at the live acceptance review that follows, never here.
