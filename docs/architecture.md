# Architecture

## Layers

```
┌─────────────────────────────────────────────────────────────────┐
│ src/triggers/            thin wiring — the only place that       │
│   syncReminders.ts       constructs real adapters and calls      │
│   heartbeat.ts           into core through ports                 │
│   onInstall.ts                                                   │
└───────────────┬───────────────────────────────┬──────────────────┘
                │                                │
                ▼                                ▼
┌───────────────────────────┐    ┌───────────────────────────────┐
│ src/adapters/              │    │ src/infra/                     │
│   sheets/   (Sheets state) │    │   retry.ts, lock.ts, config.ts │
│   slack/    (Notifier)     │    │   httpClient.ts, SystemClock   │
│   classroom/ (Classroom)   │    │                                 │
│ — the only place Apps      │    │ — the only place a raw          │
│   Script globals appear    │    │   UrlFetchApp/LockService call  │
│   besides triggers/        │    │   actually happens              │
└───────────────┬────────────┘    └───────────────┬──────────────────┘
                │ implements                        │ used by
                ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ src/ports/   ClassroomSource · ReminderStore · DeliveryStore ·    │
│              Notifier · Clock — interfaces only, the hexagon      │
│              boundary. core knows nothing beyond this.            │
└───────────────┬─────────────────────────────────────────────────┘
                │ depends on (never the other way)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│ src/core/    rules/*.ts, time.ts, reconcile.ts, planDeliveries.ts │
│              — pure functions, zero I/O, zero Apps Script globals │
│              (enforced by eslint.config.js, scoped to src/core/**)│
└─────────────────────────────────────────────────────────────────┘
```

The dependency arrow only ever points downward. `core` depends on `ports`;
`adapters`/`infra`/`triggers` depend on `ports` *and* implement them; nothing
below the top layer imports anything above it. This is what lets `core` run
under plain Vitest with no Apps Script runtime present at all (see
`test/scaffold.test.ts`), and it's what let each adapter (M4 Sheets, M5 Slack,
M6 Classroom) be built and tested independently before M7 wired any of them
into a real trigger.

## The two pure functions at the center

Everything the bot decides to do comes out of two pure functions, both called
once per sync cycle, both taking plain data in and returning plain data out —
no I/O, which is what makes their idempotency provable in a unit test (run
twice with run 1's output fed back as run 2's input → zero new changes).

### `reconcile()` — what reminders should exist right now

For every live Classroom assignment, `reconcile()`:

1. Resolves its due instant (`time.ts`'s `resolveDueInstant`) — Classroom's
   `dueDate`/`dueTime` are already UTC, so this only ever consults the user's
   timezone for the one case that needs it: a due *date* with no due *time*,
   which defaults to 23:59 local.
2. Decides whether the assignment is still "pending" (`rules/pendingState.ts`)
   — handles the `RETURNED`-but-due-date-is-still-future edge case explicitly.
3. If it's pending, computes which reminder offsets should exist: the fixed
   24h/12h/2h/1h-before-due set (`rules/dueDateRules.ts`) if there's a due
   date, or a 12h-after-posted-then-recurring set capped by
   `rolling_window_days` (`rules/noDueDateRules.ts`) if there isn't.
4. Diffs that desired set against what's already stored, keyed by
   `(assignmentId, reminderType, fireAt)` — `fireAt` is part of the key on
   purpose, so a due-date change (rule 6) falls out of the diff for free: the
   old key simply stops being desired (→ remove) while the new one appears
   fresh (→ create), with no separate "update" case needed anywhere.

The output is channel-agnostic: a `Reminder` only says *what* and *when*, never
*how* it gets delivered.

### `planDeliveries()` — what to actually do about each channel

A `Reminder` isn't itself sendable — `planDeliveries()` expands each one into
one `Delivery` per active channel (`slack` today), diffs those against stored
Deliveries the same keyed way, and decides what to call next. The **only**
thing it's allowed to branch on is a channel's `supportsScheduling` capability
flag — never its name:

- **Scheduling channel** (Slack): a new delivery → `scheduleCreate`; no longer
  desired → `scheduleCancel`. There's no documented endpoint to edit a
  scheduled message's time in place, so a due-date change is a cancel+create
  pair, not an "update."
- **Non-scheduling channel** (a future CallMeBot/WhatsApp adapter — port and
  fake exist, no real adapter yet): `schedule`/`cancel` are simply never
  called. A delivery sits as `pending` until its `fireAt` has passed, at which
  point it's due for an immediate `dispatchSendNow`.
- **Catch-up (rule 7)**, the same mechanism in both cases: any `pending` or
  `failed` delivery whose `fireAt` has already passed (a missed schedule call,
  for Slack; *every* delivery, for a non-scheduling channel) is checked
  against the assignment's actual due time — if it's still accurate, it sends
  immediately with a recomputed "due in X"; if several are overdue for the
  same assignment, only the most urgent sends and the rest cancel outright, so
  a student never gets a burst of stale reminders at once.

`planDeliveries()` reports *intent* (`notifierActions`) separately from
Sheet-bookkeeping *changes* — it has no I/O, so it can never know whether a
`schedule()` call actually succeeded. Turning that outcome into the right
`DeliveryChange` (status `scheduled` vs `failed`, with or without a real
`external_message_id`) is the orchestrator's job — see `runSyncCycle` in
`src/triggers/syncReminders.ts`.

## Why Reminder and Delivery are separate

A `Reminder` is "what and when" — channel-agnostic. A `Delivery` is one
channel's attempt at actually sending one reminder: its `status`, its
`external_message_id`, when it was last attempted. Splitting them is the one
real modeling cost of supporting multiple channels (every reminder now
produces *N* Delivery rows, one per active channel, instead of one row doing
both jobs) — but it's what makes adding a second channel later a `Config`
change (`active_channels`), not a schema migration or a core-logic change.

## One real sync cycle, end to end

`src/triggers/syncReminders.ts`'s `runSyncReminders()`, run every 10 minutes:

1. Acquire the script lock (`infra/lock.ts`, 30s timeout). Miss it → log and
   skip this cycle entirely; the next one is 10 minutes away regardless, so
   there's no reason to block.
2. Load every active row from the Config sheet (`SheetConfigStore`).
3. For each one, run `runSyncCycle()`: fetch live assignments
   (`ClassroomApiSource`), `reconcile()`, apply the resulting changes to the
   Sheet (`SheetReminderStore`), load stored deliveries, `planDeliveries()`,
   execute each `notifierAction` against `SlackNotifier`, and write the real
   outcomes back.
4. One user's failure never stops another's cycle — logged and isolated, with
   a persisted `consecutive_failure_count` feeding the two-strikes watchdog
   (see `docs/decisions.md`).
5. Release the lock in a `finally`, so a crash mid-cycle can't leave it held
   until Apps Script's own timeout.

A separate daily trigger (`heartbeat.ts`) sends a liveness DM and prunes old
Log rows — deliberately independent of whether `syncReminders` is succeeding,
since "the bot is silent because nothing happened" and "the bot is silent
because it's broken" need to be distinguishable from Slack alone.
