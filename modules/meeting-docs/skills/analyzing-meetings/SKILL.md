---
name: analyzing-meetings
description: Use when a call needs to be judged rather than recorded — "review my call with X", "was that pitch any good", "scrutinise what I said", "validate my claims on that call", a post-mortem on a lost deal, or a critique of your own performance across an arc of meetings. Produces a meeting-analyses record. The mechanics behind /analyze-meetings. Not for writing a neutral record of what happened (summarize-meeting) or pulling tasks out of a call (extract-tasks-from-meetings).
---

# analyzing meetings

**core principle: a summary is neutral, a review is not.** Its whole job is to say what was wrong
and what it cost. Write `meeting-analyses` records — see the collection descriptor for
the fields, `using-dreamteamer` → `references/records.md` for the CRUD.

Reviews **you by default** (`reviewed: users/<your-id>`) — that is the point of the exercise. Write the
quad as `author: agents/<harness>` (`agents/claude-code` under Claude Code) with your model in
`creation_context`. `about` is the `engagements/<id>` the calls belong to, never a company.

**A meeting with `privacy: restricted` is never reviewed.** It holds a third party's private material,
and its pipeline ends at the transcript: leave it out of the record and say so in one line. A meeting
with no `privacy` value is `open`.

## the one rule that decides whether this is worth anything

**Read the RAW transcripts. Never review from the summaries.** A summary has already smoothed the call
into a neutral record; the exact wording a critique lives on is gone. Every finding worth having comes
out of the transcript — a claim contradicted 90 seconds later, an objection that got a non-answer, a
credential stated loosely. None of that survives summarisation.

Read in this order:

1. **`transcription.speakers`, `transcription.notes` and the top-level `notes` on every recording,
   FIRST.** The speaker map says which transcript label is which person; `transcription.notes` is the
   transcriber's own caveat — a corrected count, an unmapped label; the recording's top-level `notes`
   is a person's note about the capture — bad audio, a missing stretch, who was off-mic. In a recording whose
   labels are conflated or unmapped, **do not attribute a line to a person** — read it as "X advising"
   and say so once, at the top of the body. Set `evidence_quality` from these (`weak` when findings
   rest on inference, `strong` when attribution and audio are clean), independently of `confidence`,
   which is about the record.
2. **The transcript bodies** — the meeting's `recordings` → each recording, in date order.
3. **The summaries** last, and only to check you have not just rewritten them.
4. **The visuals**, if the meeting has `screenshots_folder` — mechanics in `summarize-meeting`.

**Low-confidence ASR is not evidence.** Where the recording's `notes` or the text itself shows a garbled
passage — commonly a language the speech model handles poorly — never rest a finding on it, and never
critique it as if the speaker said nonsense: that is the ASR talking, not them. State this caveat once
in the body and move on.

## what makes a finding, ranked

1. **Self-contradiction across the call.** Two statements minutes apart that cannot both be true. The
   strongest findings available, and invisible to a summary. *Example: "cost is not a great
   concern, small local models suffice" followed ~90 seconds later by a definition of frontier-model
   work that exactly described the client's own workload.*
2. **Checkable claims, actually checked.** Credentials, standards, market facts, legal regimes, "there
   is no standard for X", "Fortune 10". **Verify them** — WebSearch when your knowledge may be stale or
   the claim's truth changes the advice. A loose claim in front of a counterparty whose job is
   verifying claims is a real cost, and this is the part a neutral summary structurally cannot do.
3. **An objection that got a non-answer.** Find the client's hardest question and check what came back
   actually addressed it.
4. **A proposal made before the facts were in** — especially one corrected in the room.
5. **Process and commercial failures**, which usually cost more than any wrong statement: no priced
   next step, ratios with no denominator, pitching past the buyer, unbounded warranty language.

**Anchor every finding to a `[MM:SS]` timestamp and quote the words.** That is what makes the report
falsifiable rather than opinion, and it lets you re-listen and disagree.

## the shape of the body

1. **Evidence caveat**, once, in a blockquote: what is attributable, what is not, and why.
2. **What held up** — first, specific, quoted. Not balance for its own sake: the critique below
   misrepresents the call without it.
3. **Wrong or overreached** — numbered. Each: the quote, why it is wrong, and **the cheap fix**. A
   finding without a fix is a complaint.
4. **Process failures** — the ones that cost more than any single statement.
5. **Suggestions, split two ways** — *the engagement* (what to do about this client) and *you*
   (patterns to change). Mark the single highest-leverage item.

Write the review in the language the meetings were held in — the transcript's
`transcription.language` — with every quote as it was spoken.

Then `--id` explicitly (names are long): `<YYYY>/<MM>/<YYYY-MM-DD>--<short-slug>`, dated the **review**,
not the meeting — unlike a summary, whose id is its meeting's id.

## discipline

| rationalization | reality |
|---|---|
| "the call went well, I'll find something anyway" | An invented finding poisons the real ones. Short report, say it was good. |
| "this phrasing is a bit harsh" | The brief is objective scrutiny. Softening it is the failure mode, not politeness. |
| "I'd have architected it differently" | That is taste. Label it as taste or drop it — only claims that are *wrong* go in the findings. |
| "the summary already covers this" | Then delete the paragraph. If it could appear in the summary, it does not belong here. |
| "the transcript is garbled, close enough" | Garbled ASR is not a quote. Build on clean passages only, or set `evidence_quality: weak` and say which findings are inference. |
| "I'll just fix the lead's next_steps too" | Out of scope. **Flag the conflict** in the report and let the person decide. |

**Red flags in your own draft:** no timestamps; praise with no quote behind it; a finding with no fix;
"could have been clearer" (say what was unclear and what it cost); attributing a line in a recording whose
notes say attribution is unusable.

**Never transcribe third-party personal data into the report** — same rule as `summarize-meeting`.
Name what a document *is* ("a signed LP page, investor PII, not transcribed") and move on.

Leave `follow_up` empty. Carving the suggestions into tasks is a separate, deliberate step — a review
nobody actioned is what `status` exists to expose.
