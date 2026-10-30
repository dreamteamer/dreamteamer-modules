---
name: rnd/test
description: prove the change — run every test that covers it, set each from its run, and review whether the proof is enough
argument-hint: <rnd/change-requests/id | rnd/implementation-plans/id>
---
load the `rnd-test` skill. for $ARGUMENTS: run every covering test exactly as its `runner` says and set `status` and `last_run` from the output; leave a manual test `planned` when nobody ran it; add a test for every acceptance line that has none; file an issue per failure; open the test review and give its verdict. commit by id.
