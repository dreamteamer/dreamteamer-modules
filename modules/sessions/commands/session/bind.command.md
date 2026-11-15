---
name: session/bind
description: bind records to this session — add each to the current session's records (the session record is written when absent), so each record's dt next lists the session; binding again changes nothing
argument-hint: "<collection>/<id>… [--session <id>]"
---
run `npx dt session bind $ARGUMENTS` from the workspace root and quote the line it prints, including any `… is also bound to sessions/<id>` line — that names another session working on the same record; it is said, not refused. With no record given, ask which records this session worked on.
