#!/usr/bin/env python3
"""List every tag in use across the vault, with counts. Run from the vault root, no args."""
import glob, re, sys
from collections import Counter

c = Counter()
for p in glob.glob('data/**/*.md', recursive=True) + glob.glob('data/**/*.yaml', recursive=True):
    try:
        t = open(p, encoding='utf-8').read(16000)
    except OSError:
        continue
    m = re.search(r'^tags:\s*\n((?:[ \t]+-[ \t]+.+\n)+)', t, re.M)
    if not m:
        continue
    for line in m.group(1).splitlines():
        c[line.split('-', 1)[1].strip().strip('\'"')] += 1

for tag, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])):
    print(f'{n:5}  {tag}')
print(f'\n{len(c)} distinct tags, {sum(c.values())} applications', file=sys.stderr)
