# Setup Guide (continuing from M0)

This picks up right after the M0 go/no-go spike — it assumes you've already
proven the two things that can't be worked around in code:

- [ ] A Google Cloud project exists, the **Google Classroom API** is enabled
  on it, and the OAuth consent screen is configured with the three scopes
  (`classroom.courses.readonly`, `classroom.coursework.me.readonly`,
  `classroom.student-submissions.me.readonly`) — and you confirmed your
  account can actually authorize them (no Workspace admin block).
- [ ] A Slack app exists in your workspace with bot scopes `chat:write` and
  `im:write`, installed, and you've already test-scheduled and cancelled a
  real DM via `chat.scheduleMessage`/`chat.deleteScheduledMessage`.
- [ ] You have the Slack **bot token** (`xoxb-...`) and your own **Slack
  member id** in hand from that test.
- [ ] Node 20+ and this repo cloned, with `npm install` already run.

If any of those aren't true yet, do them first — this guide doesn't repeat
that part. Everything below is building the actual bot on top of what M0
already proved works.

## 1. Create the bot's own Apps Script project

The M0 spike almost certainly used a throwaway script project just to test
authorization — this is a **separate, new** project for the real bot, so it
gets `dist/Code.js` pushed to it and nothing else.

```bash
npx @google/clasp login          # same Google account from M0, if not already logged in
npx @google/clasp create --type standalone --title "Classroom Reminder Bot"
cp .clasp.json.example .clasp.json
# fill in the scriptId clasp just printed — .clasp.json is gitignored, never commit it
```

## 2. Create the Google Sheet

Create a blank Google Sheet anywhere in your Drive. Copy its id out of the URL
(`.../spreadsheets/d/<THIS PART>/edit`) — you'll need it in step 4.

## 3. Deploy the code

```bash
npm run deploy           # builds dist/Code.js and pushes it via clasp
npx @google/clasp open   # opens the Apps Script editor in your browser
```

Quick check: the function dropdown next to **Run** in the editor should list
`setupSheet`, `listMyCourses`, `syncReminders`, `heartbeat` and
`installAllTriggers`. If it says *No functions*, see
[`docs/troubleshooting.md`](docs/troubleshooting.md#the-run-dropdown-in-the-apps-script-editor-says-no-functions)
before going any further.

## 4. Set Script Properties

In the editor: **Project Settings → Script Properties**, add:

| Property | Value |
|---|---|
| `SLACK_BOT_TOKEN` | the bot token you already have from M0 |
| `SLACK_USER_ID` | your Slack member id from M0 |
| `SHEET_ID` | the Sheet id from step 2 |

Leave `SLACK_DM_CHANNEL_ID` unset — the bot fills it in itself on first run.
See [`.env.example`](.env.example) for what each property is for.

## 5. Set up the Sheet tabs and find your course ids

Still in the Apps Script editor, select each function from the dropdown next
to **Run** and click **Run** (the first run for each prompts you to authorize
scopes — accept it):

1. **`setupSheet`** — creates the Reminders/Deliveries/Config/Log tabs with
   headers. Safe to re-run any time; it never duplicates tabs or headers.
2. **`listMyCourses`** — logs every course you're enrolled in (id + name) to
   **Executions** at the bottom of the editor. Copy the ids of the course(s)
   you want reminders for.

## 6. Fill in the Config tab

Open the Sheet (`setupSheet` created a **Config** tab) and fill in one data
row:

| Column | What to put |
|---|---|
| `user_id` | any stable string, e.g. your name with no spaces |
| `display_name` | your name (shown in alert messages) |
| `timezone` | an IANA zone name, e.g. `Asia/Karachi` — used only when an assignment has a due *date* but no due *time* |
| `course_ids` | comma-separated course ids from step 5, e.g. `123456,789012` |
| `active_channels` | `slack` |
| `rolling_window_days` | `7` (how far ahead no-due-date reminders look) |
| `active` | `TRUE` |

Leave `slack_user_id`, `slack_dm_channel_id`, and the `quiet_hours_*` columns
blank — they're reserved for future multi-user and quiet-hours support and
aren't read by the bot yet. **Slack identity for v1 comes entirely from the
Script Properties set in step 4**, not from this sheet.

## 7. Turn it on

Back in the Apps Script editor, run **`installAllTriggers`** once. This
registers the three triggers the bot runs on from then on:

- `syncReminders` every 6 hours — the safety-net sweep (Classroom push
  notifications, step 8, are the primary way changes are picked up)
- `heartbeat` once a day — a liveness DM plus Log-row pruning
- `renewPushRegistrations` once a day — keeps the push registrations from
  expiring (a harmless logged error until step 8 is done)

You can also run `syncReminders` manually once to see it work immediately
instead of waiting for the next sweep.

## 8. Push notifications (experimental, `feat/push-sync` branch)

Without this step the bot still works — it just only notices Classroom
changes on the 6-hour sweep. Do the manual spike in ADR 13
([`docs/decisions.md`](docs/decisions.md)) first if you haven't: a school
Workspace may forbid some of what follows.

1. **Use a standard Google Cloud project.** In the Apps Script editor:
   Project Settings → Google Cloud Platform (GCP) Project → Change project,
   and enter the project number of a GCP project you own. Enable the
   **Google Classroom API** and **Cloud Pub/Sub API** in it. Pub/Sub may ask
   for a billing account even though this usage stays inside the free tier.
2. **Create the topic** (Pub/Sub → Topics → Create), e.g. `classroom-push`.
   On the topic's Permissions, grant **Pub/Sub Publisher** to
   `classroom-notifications@system.gserviceaccount.com`.
3. **Deploy the web app.** `npm run deploy`, then in the editor Deploy → New
   deployment → Web app, *Execute as: Me*, *Who has access: Anyone*. Copy
   the `/exec` URL. (`clasp push` only updates the editor's HEAD — after
   later code changes, Deploy → Manage deployments → edit → New version, or
   the web app keeps running old code.)
4. **Set two more Script Properties:**
   - `PUSH_VERIFICATION_TOKEN` — a long random string (`openssl rand -hex 32`)
   - `PUBSUB_TOPIC` — `projects/<project-id>/topics/classroom-push`
5. **Create the push subscription** on the topic: delivery type *Push*,
   endpoint `<exec URL>?token=<PUSH_VERIFICATION_TOKEN>`, acknowledgement
   deadline 60 s, message retention 10 minutes (the minimum — missed pushes
   are covered by the sweep, so there's no point retrying for days).
6. Re-run **`installAllTriggers`** (it's idempotent), then run
   **`renewPushRegistrations`** once by hand and authorize the new
   `classroom.push-notifications` scope. The **Registrations** tab should get
   one row per course in `Config.course_ids`.

## Verifying it worked

- **Triggers page** (clock icon in the Apps Script editor sidebar): all three
  triggers listed, next-run times populated.
- **Push** (if step 8 is done): edit an assignment's due date in Classroom —
  within seconds the Log tab shows a `push` row "Push-triggered sync
  completed", and the Pub/Sub subscription shows no unacked backlog.
- **Log tab**: a fresh `INFO` row from `sync` after each cycle; `ERROR` rows
  would mean something's wrong (see
  [`docs/troubleshooting.md`](docs/troubleshooting.md)).
- **Slack**: a DM heartbeat once a day, and reminder DMs arriving at the
  24h/12h/2h/1h marks (or sooner, for a short-fuse test assignment) before a
  real assignment's due date — and silence after you mark it turned in.

## If something doesn't work

See [`docs/troubleshooting.md`](docs/troubleshooting.md) — it covers missing
Script Properties, `ClassroomApiError`/`SlackApiError` meanings, the
watchdog's 2-failure alert threshold, and triggers never getting registered.
