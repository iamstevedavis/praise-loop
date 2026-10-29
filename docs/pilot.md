# Three-business pilot (#47)

Status: preparation only. No live pilot observations, paid demand, or live timings
have been verified. Live workflow evaluation waits for #30, #44, #29, and #28.
This preparation PR must not close #47. Owner records outcomes or stops the experiment.

## Owner decisions and recruitment

Choose one segment from [product.md](product.md), a price/currency, a two-week observation period,
and three consenting businesses in that segment. Record these choices privately.
Owner alone contacts prospects, obtains consent, operates the pilot and invoices.
Do not send outreach, deploy, create accounts, or charge automatically.

Recruitment script (owner adapts before sending): “How do you currently turn reviews
into social posts? We are testing a tool that prepares three branded drafts weekly.
You review every post before scheduling. Could you try it for two weeks at [price],
with two short feedback calls? Participation is optional; may we record timings and
aggregate outcomes?” Do not promise provider access, publication, or sales results.

Interview: ask about last week's workflow/time/cost, review rights and frequency,
acceptable wording/branding, reasons for edits or rejection, and what would justify
paying again. At week two ask whether they returned unaided and would renew at the
stated price; distinguish stated willingness from invoiced and received payment.

## Consent and handling

Before importing, obtain documented owner authorization for the selected business,
review reuse/attribution, connected accounts, approved destinations, and the exact
measurements below. Explain AI processing and the selected providers; agree a
retention/deletion date and withdrawal contact. Verify rights and provider terms.
Keep consent/contact details and invoices outside this repository and report.
Use pseudonymous business/draft/session/receipt IDs. No review text, captions, names,
emails, prompts, tokens, or full provider responses in the ledger, logs or exports.
Keep the ledger in owner-restricted storage outside the repo; export only consented
IDs to the authorized operator. Delete ledger and exports on the agreed date;
handle source-system deletion and legally retained invoices separately.

## Operator checklist and minimal observation ledger

1. Confirm consent, segment, price, timezone, access isolation and dependencies.
2. Start a UTC timestamped ledger from `sample-data/pilot/pilot-synthetic.json`; use a new
   pseudonym and `synthetic: false` ONLY for a real consenting business.
3. Record `onboarding_start` when the owner begins business setup after sign-in.
   Record the FIRST `draft_complete` only once caption is nonempty and its image
   opens successfully in the browser. Include import, setup and waiting time.
4. For EACH weekly batch record `session_start` when the owner opens approval to
   work on it; `session_end` with the same unique session ID when that batch's
   intended scheduling results have been checked. Include waits/edits, never pause
   the clock. Abandonment leaves no end; a resumed attempt gets a new session ID.
5. Record each draft's FIRST `approved`, `scheduled`, `published` observation with
   its ID. Scheduled means provider-accepted; published means provider-confirmed,
   never inferred from the scheduled time or the current scheduler stub. Record
   actual event timestamps from persisted data when trustworthy; otherwise observe
   manually and record contemporaneously. Current DB status/updated_at alone cannot
   reconstruct transitions. Missing observations stay missing, never estimated.
6. `approved.unedited` is true only if initial approval matches the first complete
   draft's caption, quote, graphic and branding without edits or regeneration.
   Compare privately at approval; false for changed content; omit if unknown.
   Never put the comparison content in the ledger. Count each draft once.
7. Record `returned` when the owner actively opens/uses the workflow again (not an
   automated worker tick). Record `generation_cost` with unique usage receipt ID
   and nonnegative `usd` for all actual generation charges including failed calls;
   reconcile provider usage privately. Missing receipts mean cost is unknown or
   partial; report completeness separately and never call a partial sum total cost.
8. Capture redacted failure category, feedback, invoice ID/status and renewal answer
   privately. Invoice manually after agreement; record sent/paid separately. At week
   two, review use and payment willingness for ALL three businesses, including dropouts.

## Reproducible scorecard and export

Run `npm ci`, then `npm run --silent pilot:report -- /private/ledger.json pilot-a,pilot-b START END`.
START/END are UTC ISO timestamps with milliseconds, e.g. `2026-10-01T00:00:00.000Z`.
Redirect stdout to a private JSON file if needed. This offline command has no DB or
network access; the ID list selects previously owner-authorized records, not a new
authentication system. No report endpoint is exposed. Synthetic records are always
excluded (the checked-in example intentionally outputs `[]`). Unknown IDs are errors.

Windows are [START, END). First-draft duration requires onboarding and completion
inside the window. Session durations require both events inside it; missing ends
yield null, orphan ends are counted. Keep each weekly batch's session separate.
Approval rate = unchanged first approvals / all first approvals in the window;
empty denominators or any unknown edit status yield null, with known counts shown.
Duplicate IDs per event type are errors, not extra successes. Scheduled/published
counts are distinct first transitions in the window, not current-state inventories.
Week two is [onboarding + 7 days, onboarding + 14 days), measured as elapsed UTC time.
Return is true on an observed return, false only with the full interval observed,
otherwise null. Record onboarding even for a later report window. Cost is the sum
of supplied receipts in the window (null without receipts); zero needs a $0 receipt.
An empty event count means “none recorded”, not proof none occurred. Reconcile the
ledger against the live workflow before interpreting zeros or week-two non-return.

Synthetic scorecard ONLY: example first draft 4 min (<5); weekly session 12 min
(<15); unchanged approvals 1/1 (100%); scheduled 1; published unobserved; week-two
return unknown; cost unknown. These are fabricated fixture values, not results.
Tests verify this example via a test-only copy; do not relabel it as live data.
Owner scorecard: one row/business/week with these metrics, missing-data notes,
provider mode (fake/live), timing context, price, invoice sent/paid, feedback and
renewal answer. Compare strict <5/<15 targets without excluding failures/dropouts.
Use manual observation until persisted audit/job data exists; no analytics platform.
