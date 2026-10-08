# Classroom Reminder Bot

A $0 Google Classroom deadline reminder bot. Google Apps Script polls Classroom
on a schedule, tracks pending assignments in a Google Sheet, and sends Slack DM
reminders timed via `chat.scheduleMessage` so they arrive at the exact moment —
even if Apps Script itself isn't running right then. No server, no credit card,
no always-on infrastructure.

**Status:** early build. The toolchain (lint/typecheck/test/build) and the
Classroom + Slack API mechanics are verified working; the reminder logic itself
is still being built milestone by milestone. This README covers *developer*
setup (clone it, run the checks, hack on it) — a full end-user install guide
lands once the bot is feature-complete.

## Requirements

- Node.js 20+
- A Google account that's a student member of at least one Google Classroom course
- A Slack workspace you can install an app to (a free one is fine)
- [`gh`](https://cli.github.com/) or git, if you're cloning rather than forking

## Setup

```bash
git clone git@github.com:<your-username>/classroom-reminder-bot.git
cd classroom-reminder-bot
npm install
```

Verify the toolchain works:

```bash
npm run lint       # ESLint, including the rule that keeps src/core free of Apps Script globals
npm run typecheck  # tsc --noEmit, strict mode
npm test           # Vitest
npm run build      # bundles src/main.ts into dist/Code.js (Apps Script has no module loader, so this must stay a single IIFE)
```

All four should pass on a clean checkout. If they don't, that's a bug — open an issue.

## Connecting to a real Apps Script project (optional, for deploying)

1. Create a Google Cloud project, enable the **Google Classroom API**, and
   configure the OAuth consent screen with these scopes:
   `classroom.courses.readonly`, `classroom.coursework.me.readonly`,
   `classroom.student-submissions.me.readonly`.
2. `npx @google/clasp login` (use the same Google account from step 1).
3. `npx @google/clasp create --type standalone --title "Classroom Reminder Bot"`
   — then copy `.clasp.json.example` to `.clasp.json` and fill in the `scriptId`
   clasp printed (never commit this file; it's gitignored).
4. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with
   bot scopes `chat:write` and `im:write`, install it to your workspace, and
   copy the bot token.
5. In the Apps Script editor (`npx @google/clasp open`), add Script Properties
   for `SLACK_BOT_TOKEN` and `SLACK_USER_ID` (see `.env.example` for what each
   one is).
6. `npm run deploy` — builds and pushes to Apps Script.

Reminder scheduling, the Sheet-backed state, and the time-driven trigger aren't
wired up yet, so step 6 currently deploys a bot that does nothing. That's the
next milestone.

## Project layout

See `CLAUDE.md` for the architecture (hexagonal core/ports/adapters), the
module-boundary rule, and day-to-day commands.
