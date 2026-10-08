# Classroom Reminder Bot

A $0 Google Classroom deadline reminder bot. Google Apps Script polls Classroom
on a 10-minute time-driven trigger, tracks pending assignments in a Google
Sheet, and sends Slack DM reminders timed via `chat.scheduleMessage` so they
arrive at the exact moment — even if Apps Script itself isn't running right
then. No server, no credit card, no always-on infrastructure.

**Status:** feature-complete (M0–M8). A daily heartbeat and two-strikes
failure alerting watch the bot itself, so silence from Slack means "healthy."

## How it works, in one paragraph

Every 10 minutes, Apps Script fetches your pending coursework from each
allow-listed Classroom course, diffs it against what's already tracked in a
Google Sheet, and schedules (or cancels) Slack DMs for the offsets that
changed — 24h/12h/2h/1h before a due date, or a recurring reminder if an
assignment has no due date at all. Slack's own infrastructure delivers each
message at its scheduled second, so a reminder still arrives on time even if
Apps Script is briefly down when it's supposed to fire. See
[`docs/architecture.md`](docs/architecture.md) for the full design and
[`docs/decisions.md`](docs/decisions.md) for why it's built this way.

## Requirements

- Node.js 20+
- A Google account that's a student member of at least one Google Classroom
  course, under a Workspace/school domain or a personal Google account
- A Slack workspace you can install an app to (a free one is fine)
- [`gh`](https://cli.github.com/) or git, if you're cloning rather than forking

## 1. Clone and verify the toolchain

```bash
git clone git@github.com:<your-username>/classroom-reminder-bot.git
cd classroom-reminder-bot
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

All four should pass on a clean checkout. If they don't, that's a bug — open
an issue.

## 2. Create a Google Cloud project and enable the Classroom API

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   new project (or pick an existing one) under the **same Google account**
   you'll run the bot as.
2. Enable the **Google Classroom API** for that project.
3. Configure the OAuth consent screen. If your account is on a Workspace/school
   domain, choose **Internal** if that option is offered — it avoids Google's
   external-app verification review entirely. Add these three scopes:
   - `https://www.googleapis.com/auth/classroom.courses.readonly`
   - `https://www.googleapis.com/auth/classroom.coursework.me.readonly`
   - `https://www.googleapis.com/auth/classroom.student-submissions.me.readonly`

> **School/Workspace accounts:** some domain admins block third-party API
> access or restrict which OAuth scopes a user can consent to, including for
> `clasp login` itself. If authorization fails here, see
> [`docs/troubleshooting.md`](docs/troubleshooting.md) before assuming the bot
> is broken — this is a domain policy, not a bug, and the fix is usually asking
> the admin to allow the scopes above (or the specific Cloud project) rather
> than changing any code.

## 3. Create the Apps Script project

```bash
npx @google/clasp login          # same Google account as step 2
npx @google/clasp create --type standalone --title "Classroom Reminder Bot"
cp .clasp.json.example .clasp.json
# fill in the scriptId clasp just printed — .clasp.json is gitignored, never commit it
```

## 4. Create the Google Sheet

Create a blank Google Sheet anywhere in your Drive. Copy its id out of the URL
(`.../spreadsheets/d/<THIS PART>/edit`) — you'll need it in step 6.

## 5. Create a Slack app

1. At [api.slack.com/apps](https://api.slack.com/apps), create a new app in
   your workspace.
2. Under **OAuth & Permissions**, add the bot token scopes `chat:write` and
   `im:write`, then **Install to Workspace**.
3. Copy the **Bot User OAuth Token** (starts `xoxb-`).
4. Find your own Slack member id: profile picture → **"..."** menu → **Copy
   member ID**.

## 6. Configure Script Properties

```bash
npm run deploy          # builds dist/Code.js and pushes it
npx @google/clasp open   # opens the Apps Script editor in your browser
```

In the editor: **Project Settings → Script Properties**, add:

| Property | Value |
|---|---|
| `SLACK_BOT_TOKEN` | the `xoxb-...` token from step 5 |
| `SLACK_USER_ID` | your Slack member id from step 5 |
| `SHEET_ID` | the Sheet id from step 4 |

Leave `SLACK_DM_CHANNEL_ID` unset — the bot fills it in itself on first run.
See [`.env.example`](.env.example) for what each property is for.

## 7. Set up the Sheet and find your course ids

Still in the Apps Script editor, select each function from the dropdown next
to **Run** and click **Run** (the first run prompts you to authorize the three
Classroom scopes plus Sheets/Slack access — accept it):

1. **`setupSheet`** — creates the Reminders/Deliveries/Config/Log tabs with
   headers. Safe to re-run any time; it never duplicates tabs or headers.
2. **`listMyCourses`** — logs every course you're enrolled in (id + name) to
   **Executions** at the bottom of the editor. Copy the ids of the course(s)
   you want reminders for.

## 8. Fill in the Config tab

Open the Sheet (`setupSheet` created a **Config** tab) and fill in one data
row:

| Column | What to put |
|---|---|
| `user_id` | any stable string, e.g. your name with no spaces |
| `display_name` | your name (shown in alert messages) |
| `timezone` | an IANA zone name, e.g. `Asia/Karachi` — used only when an assignment has a due *date* but no due *time* |
| `course_ids` | comma-separated course ids from step 7, e.g. `123456,789012` |
| `active_channels` | `slack` |
| `rolling_window_days` | `7` (how far ahead no-due-date reminders look) |
| `active` | `TRUE` |

Leave `slack_user_id`, `slack_dm_channel_id`, and the `quiet_hours_*` columns
blank — they're reserved for future multi-user and quiet-hours support and
aren't read by the bot yet. **Slack identity for v1 comes entirely from the
Script Properties set in step 6**, not from this sheet.

## 9. Turn it on

Back in the Apps Script editor, run **`installAllTriggers`** once. This
registers the two triggers the bot runs on from then on:

- `syncReminders` every 10 minutes — the actual reminder loop
- `heartbeat` once a day — a liveness DM plus Log-row pruning

You can also run `syncReminders` manually once to see it work immediately
instead of waiting up to 10 minutes.

## Verifying it worked

- **Triggers page** (clock icon in the Apps Script editor sidebar): both
  triggers listed, next-run times populated.
- **Log tab**: a fresh `INFO` row from `sync` after each cycle; `ERROR` rows
  would mean something's wrong (see
  [`docs/troubleshooting.md`](docs/troubleshooting.md)).
- **Slack**: a DM heartbeat once a day, and reminder DMs arriving at the
  24h/12h/2h/1h marks (or sooner, for a short-fuse test assignment) before a
  real assignment's due date — and silence after you mark it turned in.

## Day-to-day development

See [`CLAUDE.md`](CLAUDE.md) for the architecture (hexagonal core/ports/
adapters), the module-boundary rule, and commands (`npm run lint`,
`npm run typecheck`, `npm test`, `npm run build`, `npm run deploy`).

## Docs

- [`docs/architecture.md`](docs/architecture.md) — the hexagonal design, the
  reconcile/planDeliveries split, and how a reminder becomes a Slack DM.
- [`docs/decisions.md`](docs/decisions.md) — why Sheets over a database, why
  `chat.scheduleMessage` over a cron-style poster, and the other ADRs behind
  this design.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — what to do when
  authorization is blocked, a sync cycle errors, or a reminder doesn't arrive.
