# Architecture Decision Records

Short-form ADRs for the choices that weren't the only reasonable option.
Ordered roughly by when each was made.

## 1. Google Sheets as the state store, not a database

**Decision:** Four tabs in a Google Sheet (Reminders, Deliveries, Config, Log)
are the entire persistence layer.

**Why:** The brief's hard constraint is $0 and no always-on infrastructure.
Apps Script's native `SpreadsheetApp` service means zero network latency to an
external DB, zero separate credentials to manage, and the state is something
a non-engineer can literally open and read. The cost is no transactions and no
indexing — mitigated by always reading/writing a tab in one batched
`getRange()`/`setValues()` round trip (never cell-by-cell) and by keeping
every diff a full-state recompute rather than an incremental mutation (see
ADR 6).

## 2. `chat.scheduleMessage`, not a cron-style poster

**Decision:** Reminders are handed to Slack as a future timestamp via
`chat.scheduleMessage`, rather than the bot itself posting at the right moment
from a tighter polling loop.

**Why:** Apps Script time-driven triggers aren't guaranteed to fire at an
exact minute, and a 10-minute cycle (see ADR 4) is nowhere near precise enough
for "arrives at the exact second." Handing the timestamp to Slack's own
infrastructure means delivery precision is Slack's problem, not this bot's —
and a reminder still arrives on time even if Apps Script is down at that exact
moment, which is the single property the brief cared about most ("never
miss"). The cost: no documented endpoint to edit a scheduled message's time in
place, so a due-date change is cancel-then-recreate (see ADR 7), and Slack
cancellation vs. actual non-delivery has to be independently verified by hand
(there's no webhook for "this scheduled message fired").

## 3. Vitest over Jest

**Decision:** Vitest as the test runner.

**Why:** Native ESM and TypeScript with effectively no config, versus Jest's
heavier `ts-jest`/babel setup for the same result. Nothing in this project
needs anything Jest has that Vitest doesn't.

## 4. 10-minute sync interval

> **Superseded by ADR 15** (4-hour sweep). Kept for the reasoning.

**Decision:** The `syncReminders` trigger runs every 10 minutes
(`src/triggers/onInstall.ts`'s `SYNC_INTERVAL_MINUTES`).

**Why:** Worst-case detection latency (10 minutes) stays well inside every gap
between reminder offsets in rule 3 (24h → 12h → 2h → 1h — the tightest gap is
one hour), and stays comfortably under both the 20-triggers-per-script limit
and the daily trigger-runtime quota (90 min/day consumer, 6 hr/day Workspace).
A tighter interval would burn quota for a precision gain the user never
notices, since actual delivery timing comes from `chat.scheduleMessage` (ADR
2), not from how often this trigger polls.

## 5. Per-user course allow-list, not "all active courses"

**Decision:** `Config.course_ids` is an explicit, user-maintained
comma-separated list; `ClassroomApiSource` only ever fetches those courses.

**Why:** Confirmed directly with the user — some enrolled courses (electives,
clubs) don't warrant deadline pressure. A `listMyCourses` helper
(`clasp run listMyCourses`) exists specifically so populating this list
doesn't require hunting through the Classroom UI for course ids.

## 6. Full-state recompute every cycle, never incremental mutation

**Decision:** `reconcile()` and `planDeliveries()` both recompute the entire
desired state from scratch on every call and diff it against stored state by
key — nothing is ever "patched in place."

**Why:** This is what makes idempotency mechanically provable: run the same
input twice and the second run's diff is empty by construction, not by
carefully-maintained bookkeeping. It also means a crashed cycle leaves no
partial-mutation damage to clean up — the next cycle just recomputes
everything again. The accepted cost is the residual risk called out in the
plan: a crash between a successful `schedule()`/`sendNow()` call and the Sheet
write could produce one duplicate delivery next cycle. Accepted explicitly,
since the brief prioritizes "never miss" over "never duplicate."

## 7. Capability-flag `Notifier`, not a class hierarchy per channel

**Decision:** One `Notifier` interface for every channel, with a
`supportsScheduling: boolean` flag, rather than separate
`SchedulingNotifier`/`ImmediateNotifier` interfaces.

**Why:** `planDeliveries()` then branches on exactly one boolean instead of an
`instanceof`/discriminated-union dance, and a future non-scheduling channel
(CallMeBot/WhatsApp — port and fake exist, no real adapter yet) type-checks
against the same interface everything else does. The cost — `schedule()`/
`cancel()` "should never be called" on a `supportsScheduling: false`
implementation — was accepted because the capability check already guarantees
correctness at the one call site that matters; forcing two interfaces would
only move that same guarantee into type-narrowing boilerplate at every call
site for no safety gain.

## 8. `sendHeartbeat`/`sendErrorAlert` live on `SlackNotifier`, not the `Notifier` port

**Decision:** The watchdog (M8) and heartbeat trigger depend on narrow
structural interfaces (`ErrorAlerter`, `HeartbeatSender`) that `SlackNotifier`
happens to satisfy, rather than adding these two methods to the real
`Notifier` port.

**Why:** Neither has a meaningful non-scheduling-channel equivalent — a future
CallMeBot adapter has no "heartbeat" concept of its own. Adding them to
`Notifier` would force every future channel implementation to carry methods it
can't meaningfully implement. Structural typing gets the real benefit (the
orchestrator takes `alerter: ErrorAlerter`, not a concrete `SlackNotifier`,
so it's still not coupled to "Slack" by name) without enlarging the port.

## 9. Injectable `shouldRetry` predicate, not Slack-specific retry logic

**Decision:** `infra/retry.ts`'s `fetchWithRetry()` takes a `shouldRetry`
override; the default only checks HTTP status (429/5xx), and `SlackNotifier`
supplies its own predicate that additionally retries Slack's
`restricted_too_many` body-level rate-limit error (HTTP 200, `{ok: false,
error: "restricted_too_many"}` — Slack's own docs describe this as a 5-minute
rolling window, so it's worth retrying, unlike the permanent `time_too_far`/
`time_in_past` errors, which are surfaced as a typed `SlackApiError` and never
retried).

**Why:** This keeps `retry.ts` fully reusable for `ClassroomApiSource` (M6),
which needs none of Slack's body-level knowledge and just uses the default
predicate — one retry module serving two unrelated APIs' different failure
shapes, instead of two near-duplicate retry implementations.

## 10. 24-hour reminder retention grace window

**Decision:** `reconcile()` keeps a reminder whose own `fireAt` has already
passed in the "desired" set for up to 24 hours past that point
(`RETENTION_GRACE_MS` in `src/core/reconcile.ts`), rather than dropping it
from desired state the instant its fire time passes.

**Why:** Catch-up (rule 7, see `docs/architecture.md`) can only fire for a
delivery `planDeliveries()` can still see. If a fresh recompute dropped an
offset from "desired" the moment its `fireAt` passed, a missed
`schedule()` call (Apps Script down at the wrong 10-minute mark) would become
invisible to the very mechanism meant to catch it — and this is the *only*
dispatch path a non-scheduling channel has at all, not just a rare edge case
for Slack. 24 hours is generous slack across many missed cycles, bounded so a
permanently-stuck reminder can't accumulate state forever.

## 11. Two-strikes watchdog threshold, and alerting continues past it

**Decision:** The sync failure counter must reach 2 consecutive failures
before the first alert fires (`FAILURE_ALERT_THRESHOLD` in
`src/triggers/syncReminders.ts`), and then an alert fires on *every* failing
run after that — not just once — until a success resets the counter to zero.

**Why:** A single failed cycle is often transient (one flaky HTTP call that
`infra/retry.ts` didn't happen to cover) and alerting on every blip would
train the user to ignore the alert channel entirely. Two in a row is a much
stronger signal something is actually broken. Alerting every run after that
(not just once) means the user can't miss the fact that it's *still* broken
just because they missed the first DM — silence from the bot should always
mean healthy, never "already told you once."

## 12. M0's live verification is a manual step the installer performs, not something this build captured

**Context:** The original plan called for M0 to stand up real Google Cloud
and Slack credentials and record empirical findings in this file — exact
Workspace-admin block text if blocked, confirmed scope names, etc.

**Decision:** This build was done without a live Google Workspace account or
Slack workspace available, so no live M0 spike was actually run. Every
adapter was built and contract-tested against documented API shapes (Classroom
REST, Slack Web API) and fixture JSON instead. `docs/troubleshooting.md`
documents the generic, documented failure modes (OAuth scope rejection, token
scope errors, Classroom 404/403s) rather than a specific captured error
string, and says so explicitly rather than inventing one.

**Consequence:** The very first time someone actually deploys this (README
steps 2–3), they are the ones running M0's real go/no-go check. If a Workspace
admin blocks something, the fix is almost always an admin-side allowance, not
a code change — but if it turns out to need one, that's the one open question
this build couldn't close in advance.

## 13. Push-primary sync via Classroom registrations + Pub/Sub (shelved)

**Status:** Shelved 2026-10-15: not possible at $0 for this account (see
"Live result" below). The code is preserved, untouched, on the
`feat/push-sync` branch. The whole-bundle tests it gained live on
`test/push-sync-e2e`.

**Context:** The 10-minute poll (ADR 4) makes 144 runs a day, each re-reading
every followed course from Classroom even when nothing changed. That is $0
and well inside quota, so this is an efficiency and latency experiment, not
a fix for a real failure.

**Decision:** Classroom changes arrive as push notifications. A
`COURSE_WORK_CHANGES` registration per followed course publishes to a Cloud
Pub/Sub topic, and a push subscription POSTs to the Apps Script web app's
`doPost`, which runs the normal sync for the users following that course.
Registrations are renewed daily. The time-driven sync stays as a 6-hour
safety-net sweep, because `reconcile()` depends on `now` (rolling window,
catch-up, retention) and no event fires when only time passes.

**Why this shape:**
- Classroom's only push mechanism is Pub/Sub. There's no direct HTTP webhook.
- A Pub/Sub *pull* subscription read from a time trigger would just be
  polling again, only cheaper per tick. Push to `doPost` is the only option
  that needs no time trigger at all for the common case.
- Deduplication is by publish time against the last sync start
  (`core/pushCoverage.ts`), not a cooldown, so bursts and redeliveries
  collapse without dropping a later change.

**Costs and risks (why it isn't on `main`):**
- **Breaks the "no card" stance.** Needs a standard GCP project, and Pub/Sub
  may require a billing account even though usage stays in the free tier.
- **Anonymous web app.** Pub/Sub can't sign in, so the web app must allow
  *Anyone*. A school Workspace admin may forbid that outright. The only auth
  is a shared secret in the endpoint URL's query string (which shows up in
  Pub/Sub's config and possibly in logs). Pub/Sub's OIDC-signed push isn't
  usable because Apps Script never exposes the `Authorization` header to
  `doPost`.
- **Student eligibility unverified.** Whether a student account (not a
  teacher) may create `COURSE_WORK_CHANGES` registrations in a given school
  domain has not been checked live.
- **No way to nack.** Apps Script can't return a non-2xx, so a push that hits
  a busy lock or a crash is lost. The sweep recovers it, within 6 hours
  instead of 10 minutes.
- **More moving parts.** A web app deployment that must be re-versioned after
  each `clasp push`, a daily renewal job, and a new tab and scope.

**Required before any merge:** a live spike (the same idea as ADR 12) on
the real school account. Create the topic and subscription, deploy the web app
as Anyone, register one course as the student, then edit an assignment and
turn one in. Confirm (a) registration is permitted, (b) the POST arrives, and
(c) Pub/Sub sees it acknowledged (no retry storm from a 302). If any of these
fails, record the exact error here. That is a valid outcome for this
experiment.

**Live result (2026-10-15):** stopped at the first step. A new Cloud project
created by the school account (Owner role) refused to create the Pub/Sub topic
(`404 Permission denied on resource or it may not exist`). The project had
`billingEnabled: false` and the account can see no billing account. Pub/Sub
needs billing, which needs a card, so push is out for a $0 bot. Registration
and the 200-vs-302 question were never reached. Polling moved to every 4
hours instead (ADR 15).

## 14. An already-fired scheduled message is "sent"; cancels are idempotent; deliveries always persist

**Context:** in production the sync failed every 10 minutes with
`chat.deleteScheduledMessage failed: invalid_scheduled_message_id`, and
reminders arrived in duplicate. Slack drops a scheduled message's id once it
posts. `planDeliveries` still asked to cancel any no-longer-wanted `scheduled`
row, even one whose `fireAt` had passed. `runSyncCycle` let that throw escape
before `deliveryStore.applyChanges`, so the cycle saved nothing. That meant
the bad cancel repeated forever, and every run re-scheduled (and never
recorded) its new reminders.

**Decision**, one fix per layer, each enough to break the loop on its own:
- **Core:** a `scheduled` delivery whose `fireAt <= now` is treated as
  delivered. `planDeliveries` emits `markSent` for it and no `scheduleCancel`.
  "Scheduled with a channel that schedules natively, and the time has passed"
  is the definition of sent.
- **Adapter:** `SlackNotifier.cancel` treats `invalid_scheduled_message_id`
  as success. The wanted outcome is "not queued any more", and that also covers
  Slack's short no-delete window just before `post_at`.
- **Orchestrator:** `runSyncCycle` persists in a `finally`, so any message
  Slack accepted is always recorded. A cancel that genuinely fails is left
  `scheduled` for the next cycle to retry, and its error is rethrown after
  persisting, so the watchdog still reports real failures.

A one-off `purgeOrphanScheduledMessages` entry point cleans up the duplicates
the old loop left queued in Slack. It holds the script lock so it can't race a
sync that is between scheduling and recording.

**Follow-up found by the whole-bundle tests (`test/e2e/`): unsubmit never
re-scheduled reminders.** Turn-in cancels the Deliveries rows. Unsubmitting
makes the same (assignment, offset, fireAt) desired again, but
`planDeliveries` treated any existing row as "already handled". A cancelled
delivery whose `fireAt` is still ahead is now planned again (the store upserts
by key). A past cancelled one stays cancelled, because catch-up cancels
superseded past reminders on purpose.

## 15. 4-hour sync sweep

**Context:** the 10-minute poll (ADR 4) made 144 executions a day, which
buried anything worth reading in the Executions log. Free push isn't
available (ADR 13).

**Decision:** `syncReminders` runs every 4 hours (`SYNC_SWEEP_HOURS` in
`src/triggers/onInstall.ts`): 6 runs a day plus the daily heartbeat.

**Why it's safe:** the poll interval never delays a reminder. Slack holds each
scheduled message and posts it at the exact second (ADR 2). The interval only
bounds how long a Classroom change takes to be *noticed*:
- **New assignment or due-date change:** reminders appear within 4 hours. One
  posted with less than 4 hours left gets its most urgent reminder sent
  immediately when the sweep sees it (catch-up, rule 7).
- **Turned in:** reminders already queued in Slack can still arrive for up to
  4 hours. Run `syncReminders` from the editor after turning work in to cancel
  them straight away.
- **No-due-date assignments:** the 7-day rolling window is topped up 6 times a
  day, far more than it needs.

**Cost:** slower reaction to changes, accepted for a readable Executions log.
Running the sweep by hand is the escape hatch.
