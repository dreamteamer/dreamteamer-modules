---
name: session/save
description: save this session — upsert its sessions record with the metrics read from the transcript (turns, tool calls, tokens, cache, cost, durations, models, lines changed) and a recap in the session's own words
argument-hint: "[--session <id>] [--set worker=users/<id>] [--set project=projects/<id>]"
---
load the `managing-sessions` skill and do its save for: $ARGUMENTS (default: the current session).
