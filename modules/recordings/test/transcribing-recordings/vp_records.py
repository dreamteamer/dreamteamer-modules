"""A record double for `meeting_io.read_meeting` / `write_meeting` (cr-modules-019 task 9).

The real pair reads and writes YAML with PyYAML, which CI's bare python3 does not have. This double keeps
every record it wrote in memory and writes it through to its file with the frontmatter as JSON — and JSON
is YAML, so the file is a record the engine and PyYAML read, and a test can keep records in a temp git
repository. It reads back a file it did not write too, as long as its frontmatter is JSON.

Owned by task 9: later tasks import it and never edit it.
"""
from __future__ import annotations

import copy
import json
import os


class Records:
    """`read(path) -> (fm, body)` and `write(path, fm, body)`, the signatures of `read_meeting` and
    `write_meeting`. `writes` lists every path written, in order."""

    def __init__(self):
        self.files = {}
        self.writes = []

    def write(self, path, fm, body):
        path = os.path.abspath(path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fm_text = json.dumps(fm, indent=2, ensure_ascii=False)
        text = f"---\n{fm_text}\n---\n\n{(body or '').strip()}\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        self.files[path] = (copy.deepcopy(fm), body)
        self.writes.append(path)

    def read(self, path):
        path = os.path.abspath(path)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        if not text.startswith("---\n"):
            raise ValueError(f"record has no frontmatter: {path}")
        close = text.index("\n---", 4)
        fm = json.loads(text[4:close]) or {}
        body = text[close + 4:].lstrip("\n")
        return fm, body

    def fm(self, path):
        return self.read(path)[0]
