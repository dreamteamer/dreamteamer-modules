---
name: ingest-reference
description: record a capture — a screen recording, a PDF, a URL — as a `rnd/references` record, moving the bytes into FILES_FOLDER and extracting frames
argument-hint: <file path or URL> [--name "<maker> <surface>"] [--type product|feature|flow|design|document]
---
load the `building-from-references` skill (section 1). for the capture in $ARGUMENTS:

1. name it `<maker> <surface>` and create the record: `npx dreamteamer add rnd/references --name … --type …
   --company companies/<id> --audience … --observed_on <date>`; find or create the maker in `companies` first.
2. a FILE moves out of the inbox into `${env:FILES_FOLDER}/rnd/references/<id>/` and the record gets
   `reference_file` as that template (never a machine path); a URL goes in `url`.
3. a recording becomes frames: `bin/extract-frames.mjs --in … --out … --every 4 --sheet`, then set
   `screenshots_folder`. check the audio before transcribing anything — most screen recordings are mute.
4. read the contact sheet, then write the body: the feature inventory, screen by screen, with frame numbers.

then `dt next rnd/references/<id>` — it will say `/write-reference-prd` is next. commit `rnd/references/<id>` scoped.
