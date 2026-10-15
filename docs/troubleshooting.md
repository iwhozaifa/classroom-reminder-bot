# Troubleshooting

This covers the documented, known failure modes. See
[`docs/decisions.md`](decisions.md#12-m0s-live-verification-is-a-manual-step-the-installer-performs-not-something-this-build-captured)
for why the exact wording of a Workspace admin block isn't reproduced here —
this build never had a live Workspace account to capture it from, so what
follows is what to check, not an exact string to search for.

## Authorization / OAuth problems (setup time)

**Symptom:** `clasp login` itself fails, or the first `clasp run` of any
function in the Apps Script editor shows an authorization error instead of
running.

- **A Workspace/school admin can block API access or restrict which OAuth
  scopes a user may consent to**, independently of anything in this repo.
  This is a domain policy decision, not a bug — the fix is asking the admin to
  allow the Classroom API/the specific Cloud project, or to allow the three
  scopes listed in the README's step 2, for your account.
- **Check which of the two things actually failed** — they're separate OAuth
  clients: `clasp login` (your Google account authorizing the `clasp` CLI
  itself) versus the Apps Script project's own authorization prompt (your
  account authorizing *this script* to use the Classroom/Sheets/external-
  request scopes in `appsscript.json`). An admin block on one doesn't
  necessarily mean the other is blocked too.
- If your account is **not** on a Workspace domain (a personal Google
  account), the OAuth consent screen may need to go through Google's
  "External" user type instead of "Internal" — this project only requests
  read-only, non-sensitive scopes, so it shouldn't trigger a verification
  requirement, but Google's own review criteria can change independently of
  this doc.

## `Script Property <X> is not set.`

Thrown by `src/infra/config.ts` / `src/main.ts`'s `getSheetId()`. Means one of
`SLACK_BOT_TOKEN`, `SLACK_USER_ID`, or `SHEET_ID` is missing from **Project
Settings → Script Properties** in the Apps Script editor. `SLACK_DM_CHANNEL_ID`
is the one property that's supposed to start blank (see README step 6).

## `Sheet tab "X" not found — run setupSheet first.`

Every real entry point (`syncReminders`, `listMyCourses`, `heartbeat`) checks
for its tab before touching it. Run `setupSheet` once from the Apps Script
editor — it's idempotent, safe to re-run any time.

## A `ClassroomApiError` in the Log tab

`src/adapters/classroom/ClassroomApiError.ts` carries Classroom's own
`status` string (e.g. `NOT_FOUND`, `PERMISSION_DENIED`). A single bad course
id in `Config.course_ids` (removed course, typo, a course you're no longer a
member of) is logged as an `ERROR` and skipped — it does **not** stop the
other allow-listed courses from syncing that cycle. Fix: correct or remove
that course id from `Config.course_ids`.

## A `SlackApiError` in the Log tab

- `invalid_auth` / `not_authed` — `SLACK_BOT_TOKEN` is wrong, revoked, or the
  app was reinstalled (reinstalling issues a new token).
- `missing_scope` — the Slack app is missing `chat:write` or `im:write` under
  **OAuth & Permissions**; reinstall the app after adding the scope.
- `time_too_far` / `time_in_past` — Slack's own `chat.scheduleMessage` limits
  (max 120 days ahead; rejects a timestamp already in the past). These are
  intentionally never retried (see `docs/decisions.md` ADR 9) since retrying
  the exact same bad timestamp can't help — if you see this for a reminder
  that should be a valid future time, it points at a due-date resolution bug,
  not a transient issue; open an issue with the assignment's due date/time and
  your configured `timezone`.
- `restricted_too_many` **is** retried automatically (Slack describes this as
  a 5-minute rolling window) — seeing it briefly in the Log is not a problem
  by itself; seeing it block an actual delivery would be.
- `invalid_scheduled_message_id` from `chat.deleteScheduledMessage` — see the
  next section.

## "Sync has now failed N times in a row … `invalid_scheduled_message_id`"

**Cause (fixed by ADR 14):** a reminder was already posted by Slack, which
throws away its scheduled-message id. Then its assignment was turned in, its
due date moved, or the daily window rolled past it. Older builds tried to
cancel it anyway. The failed cancel aborted the whole cycle before anything
was saved, so the same cancel failed again on every run. Every failed run had
also scheduled its new reminders with Slack *without recording them*, so the
next run scheduled them again. That is why the same reminder arrived two or
more times.

**Fix:** deploy a build with ADR 14, then run `purgeOrphanScheduledMessages`
once from the editor's Run dropdown. It deletes every reminder still queued in
your DM that no `scheduled` Deliveries row owns, and prints how many it
removed in the Executions log. The next sync re-schedules anything it still
needs. The failure count in Config resets to 0 on the first successful sync.

## Two alert DMs never arrived after I broke something on purpose

The watchdog only alerts from the **2nd** consecutive failure onward (see
`docs/decisions.md` ADR 11) — a single failed cycle is silent by design. Check
the Log tab for `ERROR` rows with a `failureCount` in the context column to
confirm the counter is actually incrementing; if the sync is instead erroring
out *before* reaching the per-user try/catch (e.g. the lock itself can't be
acquired, or `SheetConfigStore` can't be constructed), it won't be attributed
to any user's `consecutive_failure_count` at all — that points at a
Script-Property or Sheet-structure problem (see the two sections above), not
the watchdog.

## Nothing happens at all — no Log rows, ever

Check the **Triggers** page (clock icon) in the Apps Script editor. If
`syncReminders`/`heartbeat` aren't listed, `installAllTriggers` was never run
(or was run before `setupSheet`/Script Properties were in place, and errored
before creating the triggers). Run `installAllTriggers` from the function
dropdown and check **Executions** for any error.

## The Run dropdown in the Apps Script editor says "No functions"

The editor only lists **top-level** `function` declarations. `npm run build`
generates one for every key of `entryPoints` in `src/main.ts`, at the bottom
of `dist/Code.js`. If the dropdown is empty:

- The project still has a bundle pushed by an older build (from before these
  stubs were generated). Run `npm run deploy` again and reload the editor tab.
- `grep '^function ' dist/Code.js` should list `setupSheet`, `listMyCourses`,
  `syncReminders`, `heartbeat` and `installAllTriggers`. If a function you
  added is missing, it wasn't added to `entryPoints`.
- `npx clasp status` must list `dist/Code.js` under "Not ignored files" — if it
  doesn't, `.claspignore` is excluding it (patterns there are relative to
  `rootDir`, i.e. `dist/`).

## "Specified permissions are not sufficient to call …"

`appsscript.json` declares `oauthScopes` explicitly, so Apps Script only
grants exactly those scopes. It does not auto-detect any others from the
code. The error names the missing one (e.g. `ScriptApp.getProjectTriggers`
needs `https://www.googleapis.com/auth/script.scriptapp`). To fix:

1. Add the scope from the error's "Required permissions" line to
   `oauthScopes` in `appsscript.json`, and a matching row to
   `test/manifest.test.ts` so it can't regress.
2. `npm run deploy`.
3. Run any function from the editor again — Google shows a fresh consent
   prompt for the new scope; accept it.

## Push notifications (`feat/push-sync` branch)

- **Log tab shows `Rejected push with missing or wrong token`.** The push
  subscription's endpoint URL doesn't end in
  `?token=<PUSH_VERIFICATION_TOKEN>` exactly, or the property was changed
  without updating the subscription. If you never set up a subscription, it's
  someone probing the public `/exec` URL. That's harmless, but rotate the
  token if it ever leaked.
- **No `push` rows at all after editing an assignment.** Check in order:
  the Registrations tab has a non-expired row for that course (else run
  `renewPushRegistrations` and read its Log rows); the topic grants Pub/Sub
  Publisher to `classroom-notifications@system.gserviceaccount.com`; the
  subscription's endpoint is the *current* web app deployment's `/exec` URL;
  the deployment's access is *Anyone*. If a Workspace admin blocks *Anyone*,
  push can't work on that domain, and the 6-hour sweep is all you get.
- **`renewPushRegistrations` fails with `PERMISSION_DENIED`.** The
  `classroom.push-notifications` scope wasn't authorized (run it once by hand
  from the editor), the Classroom API isn't enabled in the linked GCP
  project, or the domain doesn't allow this account to register for that
  course's feed.
- **Pub/Sub subscription shows a growing unacked backlog / redeliveries.**
  The endpoint is answering with something other than a 2xx, most likely a
  302 because `doPost` returned a value. It must return nothing. Redeliveries
  are still harmless (they're skipped as already covered), and the 10-minute
  retention bounds them.
- **Log shows `Push-triggered sync skipped (lock busy)`.** Another sync held
  the lock past its 30s wait. Apps Script can't ask Pub/Sub to redeliver, so
  `doPost` schedules a one-shot `catchUpSync` trigger about a minute later.
  Only one is ever pending, however many pushes were skipped. It deletes itself
  when it runs, and re-arms if the lock is still busy. If you see a
  `catchUpSync` trigger that's hours old on the Triggers page, its run failed:
  check Executions.