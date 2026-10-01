# collecting — the judging loop and the paste-back prompts

The two parts of stage 4 (**collect**) that are procedure rather than a command line. The readers
themselves are one line each in `SKILL.md`'s stages table; this file is what happens around them.
`SK=<extensions>/modules/perspective/skills/running-retrospectives`.

## the judging loop

For each candidate conversation (depth `minimal`, `gate_reason` empty), in waves of at most six
subagents on a cheaper model:

1. `node $SK/bin/digest.mjs <conversation-id> --budget 12000` → the subagent reads THIS, never the file.
2. It writes exactly the judged fields — `summary · goals · key_topics · outcome · knowledge_kinds ·
   interest_score · interest_reason · subject_repos · divergences · plan_changes` — plus a
   `--body-file` whose text opens `# <title>` and carries a `## recap (no PII)` section (three to six
   sentences, no name, company, repo, path, ticket or identifying figure — the paragraph that is safe
   to put in a report), with anything identifying under a later `## detail`. Scored against
   `references/interest-score.md`, landed with `node $SK/bin/record-judgement.mjs <conversation-id>
   --json '<object>' [--body-file <write-up.md>]`.
3. Each wave reports its batch mean and median `interest_score`. Corpus median is ~33; a batch mean
   above 40 is re-scored, not accepted.

A judged payload carrying `turns_user` or any other counted field is rejected whole — that is the
merge guard, and it is why a subagent cannot corrupt a number it did not compute.

## the paste-back prompts

Give these verbatim, one per tool. The reply is saved to a file and imported.

**For ChatGPT:**
> Based on everything you remember about me from our conversations — my memory, my custom
> instructions, and the topics I keep returning to — write a plain-language account of my work: what
> I do, what I am responsible for, which projects and tools keep coming up, what I repeatedly ask
> for help with, and what I seem to find hard or annoying. Write it in paragraphs, not bullet points.
> Say clearly which parts you are confident about and which are guesses. Do not flatter me.

**For Gemini:**
> Using what you know about me from our past conversations and saved information, describe my work
> in plain paragraphs: my role and responsibilities, the projects and tools that come up most, the
> tasks I ask about again and again, and the things I struggle with or repeat. Mark what is certain
> and what is inferred. No bullet points, no compliments.
