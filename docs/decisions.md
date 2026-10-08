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
