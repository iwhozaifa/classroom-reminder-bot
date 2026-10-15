# Webhook (push) sync — test setup guide

How to try the experimental push-based sync on the `feat/push-sync` branch.
Background and trade-offs: ADR 13 in [`docs/decisions.md`](docs/decisions.md).
Push failure modes: the "Push notifications" section of
[`docs/troubleshooting.md`](docs/troubleshooting.md).

> Do this on a **separate test copy** of the bot. Deploying this branch to your
> real script project replaces your working bot and its 10-minute trigger.

## 0. Before you start (5 min)

- **Can you get a Google Cloud project?** You need to create one, and Pub/Sub
  may ask for a billing card. Usage stays inside the free tier.
- **Does your school allow public web apps?** In the Apps Script editor, go to
  Deploy → New deployment → Web app. If "Who has access" offers **Anyone**,
  you're fine. If it only offers "Anyone within [school]", stop: push can't
  work on your domain.

## 1. Make a test copy of the bot

```bash
git checkout feat/push-sync
npm install
mv .clasp.json .clasp.json.prod      # keep your real scriptId safe (clasp create refuses if .clasp.json exists)
npx clasp create --type standalone --title "Classroom Bot (push test)" --rootDir dist
```

- Create a new blank Google Sheet and copy its id.
- In the new script's Project Settings → Script Properties, set
  `SLACK_BOT_TOKEN`, `SLACK_USER_ID` and `SHEET_ID` (the new Sheet).
- Run `npm run deploy`, then run `setupSheet` from the editor. That creates
  the tabs, including **Registrations**.
- Fill one row in the **Config** tab, the same as your real one. Use just 1
  course in `course_ids` to start.

## 2. Set up Google Cloud (console.cloud.google.com)

1. **Create a project**, e.g. `classroom-push-test`. Note its **project
   number** and **project ID**.
2. **Enable two APIs:** go to APIs & Services → Library and enable **Google
   Classroom API** and **Cloud Pub/Sub API**.
3. **Configure the consent screen:** go to APIs & Services → OAuth consent
   screen and choose **Internal**. Fill in the app name and your email. Apps
   Script requires this before it can switch projects.
4. **Create the topic:** go to Pub/Sub → Topics → Create topic, ID
   `classroom-push`, and leave "default subscription" unticked.
5. **Let Classroom publish to it:** open the topic → Permissions → Add
   principal: `classroom-notifications@system.gserviceaccount.com` with role
   **Pub/Sub Publisher**.

## 3. Link the Apps Script project to it

- In the Apps Script editor, go to Project Settings → Google Cloud Platform
  (GCP) Project → **Change project** and paste the project **number**.

## 4. Deploy the web app

- In the editor, go to Deploy → New deployment → type **Web app**.
  - Execute as: **Me**
  - Who has access: **Anyone**
- Authorize it when prompted, then copy the **Web app URL** (ends in `/exec`).
- After any later `npm run deploy`, go to Deploy → Manage deployments → ✏️ →
  Version: **New version**. Without this, the web app keeps running the old
  code.

## 5. Add two Script Properties

- `PUSH_VERIFICATION_TOKEN`: generate one with `openssl rand -hex 32`
- `PUBSUB_TOPIC`: `projects/<project-ID>/topics/classroom-push`

## 6. Create the push subscription

Go to Pub/Sub → Subscriptions → Create:

- Topic: `classroom-push`
- Delivery type: **Push**
- Endpoint: `<your /exec URL>?token=<PUSH_VERIFICATION_TOKEN>`
- Acknowledgement deadline: **300 s**. A sync plus a 30 s lock wait can take
  longer than 60 s, and every redelivery costs an extra execution.
- Message retention: **10 minutes**

## 7. Turn it on

In the editor, run each of these once:

1. `installAllTriggers`. This creates the 6-hour sweep, the daily heartbeat
   and the daily renewal.
2. `renewPushRegistrations`. Authorize the new Classroom push scope when
   asked.
   - ✅ The **Registrations** tab gets a row with an expiry about 7 days out.
   - ❌ `PERMISSION_DENIED` in the Log tab means your school or Classroom
     won't let a student register. That's the main unknown. Write down the
     exact error, because it's a valid result for this test.
3. `syncReminders` once, so the Sheet has a baseline.

## 8. Test it

**a) Is the endpoint secure?**

```bash
curl -X POST "<exec URL>?token=wrong" -d '{}'
```

The Log tab should show `Rejected push with missing or wrong token`.

**b) Does a real change trigger a sync?** As a student, you can't edit
assignments, but turning work in counts as a change:

- In a course from your Config, open a pending assignment and click
  **Turn in**.
- Within a few seconds to a minute, the Log tab should show a `push` row:
  **"Push-triggered sync completed"**.
- The Slack reminders scheduled for that assignment should be cancelled.
- Click **Unsubmit**. A new push arrives and the reminders are scheduled
  again.
- If a teacher posts or changes a due date, that should also push.

**c) Is Pub/Sub happy?** Go to Pub/Sub → Subscriptions → yours → **Metrics**.
The unacked message count should stay at about 0. A climbing count means the
endpoint isn't returning a 200.

**d) Is the bot still healthy?** The daily heartbeat DM should still arrive,
and the Executions page shows far fewer runs than before.

## 9. If something fails

[`docs/troubleshooting.md`](docs/troubleshooting.md) has a "Push
notifications" section with the likely causes:

- **No push rows at all:** check the topic permission, then the endpoint URL
  and token, then the deployment version.
- **"skipped (lock busy)":** another sync was running. A one-shot
  `catchUpSync` trigger runs about a minute later and picks the change up.

## 10. Clean up / go back

- **Real bot:** never touched. Restore its config with
  `mv .clasp.json.prod .clasp.json`.
- **Test copy:** delete the test script project, its Sheet, and the GCP
  project (or just its topic and subscription). Classroom registrations
  expire by themselves within 7 days.

## What to report back

The results of **step 7.2** (did registration succeed?) and **step 8b** (did
turning work in produce a push-triggered sync?). Those two answers decide
whether this approach works for your school at all.
