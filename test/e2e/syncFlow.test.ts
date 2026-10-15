import { beforeEach, describe, expect, it } from 'vitest';
import { CATCH_UP_SYNC_FUNCTION } from '../../src/triggers/onInstall.js';
import { AppsScriptWorld, pushEnvelope, TOPIC } from './bundleHarness.js';

const HOUR = 3_600_000;

/** A world with one user following two courses, one pending assignment due in ~2 days. */
function makeWorld(): AppsScriptWorld {
  const world = new AppsScriptWorld();
  world.addCourse('c1', 'BSCS-5A Software Engineering (Fall 2026)', [
    { id: 'cw-1', title: 'Lab 4: Binary Trees', dueAt: Date.now() + 50 * HOUR, submissionState: 'CREATED' },
  ]);
  world.addCourse('c2', 'Linear Algebra - Section A', []);
  world.addUser('u1', ['c1', 'c2']);
  return world;
}

describe('push sync through the shipped bundle — happy path', () => {
  let world: AppsScriptWorld;
  beforeEach(() => {
    world = makeWorld();
  });

  it('a valid push syncs the following user over all their courses and schedules readable reminders', () => {
    const result = world.doPost(pushEnvelope('c1'));

    // Must return nothing: any ContentService output is served via a 302, which Pub/Sub treats as a failure.
    expect(result).toBeUndefined();
    expect(world.consoleErrors).toEqual([]);

    expect(world.callsTo('/courses/c1/courseWork?')).toHaveLength(1);
    expect(world.callsTo('/courses/c2/courseWork?')).toHaveLength(1);

    const deliveries = world.table('Deliveries');
    expect(deliveries.map((d) => d.reminder_type).sort()).toEqual(['12h', '1h', '24h', '2h']);
    expect(deliveries.every((d) => d.status === 'scheduled' && String(d.external_message_id).startsWith('Q'))).toBe(true);
    expect(world.slackQueue.size).toBe(4);

    const text = [...world.slackQueue.values()][0]!.text;
    expect(text).toContain('*Software Engineering* — Lab 4: Binary Trees');
    expect(text).toContain('<https://classroom.google.com/c/c1/a/cw-1/details|Open in Classroom>');

    expect(world.properties.get('push.lastSyncStartedAt.c1')).toMatch(/^\d+$/);
    expect(world.properties.get('push.lastSyncStartedAt.c2')).toMatch(/^\d+$/);
    expect(world.properties.get('SLACK_DM_CHANNEL_ID')).toBe('D12345678');
    expect(world.logMessages('push')).toEqual(['Push-triggered sync completed']);
  });

  it('a Pub/Sub redelivery of the same push is skipped as covered, with no Classroom or Slack traffic', () => {
    const body = pushEnvelope('c1');
    world.doPost(body);
    world.resetCalls();

    world.doPost(body);

    expect(world.calls).toEqual([]);
    expect(world.logMessages('push')).toEqual([
      'Push-triggered sync completed',
      'Push already covered by a later sync, skipping',
    ]);
  });

  it('a newer push published after the last sync started syncs again and picks up the change', () => {
    world.doPost(pushEnvelope('c1'));
    world.setWork('c1', [
      ...world.courses.get('c1')!.work,
      { id: 'cw-2', title: 'Quiz 2', dueAt: Date.now() + 30 * HOUR, submissionState: 'NEW' },
    ]);

    world.doPost(pushEnvelope('c1', { publishTime: Date.now() + 10_000, messageId: '2' }));

    expect(world.table('Deliveries').filter((d) => d.assignment_id === 'cw-2')).toHaveLength(4);
    expect(world.logMessages('push')).toEqual(['Push-triggered sync completed', 'Push-triggered sync completed']);
  });

  it('a student-submission event (turn in) cancels every pending reminder for that assignment', () => {
    world.doPost(pushEnvelope('c1'));
    expect(world.slackQueue.size).toBe(4);

    world.setWork('c1', [{ ...world.courses.get('c1')!.work[0]!, submissionState: 'TURNED_IN' }]);
    world.doPost(
      pushEnvelope('c1', {
        collection: 'courses.courseWork.studentSubmissions',
        publishTime: Date.now() + 10_000,
        messageId: '2',
      }),
    );

    expect(world.slackQueue.size).toBe(0);
    expect(world.callsTo('chat.deleteScheduledMessage')).toHaveLength(4);
    expect(world.table('Deliveries').every((d) => d.status === 'cancelled')).toBe(true);
    expect(world.table('Reminders')).toEqual([]);
  });

  it('unsubmitting re-schedules the reminders that are still ahead', () => {
    world.doPost(pushEnvelope('c1'));
    const work = world.courses.get('c1')!.work[0]!;
    world.setWork('c1', [{ ...work, submissionState: 'TURNED_IN' }]);
    world.doPost(pushEnvelope('c1', { publishTime: Date.now() + 10_000, messageId: '2' }));

    world.setWork('c1', [{ ...work, submissionState: 'RECLAIMED_BY_STUDENT' }]);
    world.doPost(pushEnvelope('c1', { publishTime: Date.now() + 20_000, messageId: '3' }));

    expect(world.slackQueue.size).toBe(4);
    expect(world.table('Deliveries').filter((d) => d.status === 'scheduled')).toHaveLength(4);
  });

  it('turning in after Slack already posted a reminder never fails the sync (ADR 14 regression)', () => {
    world.doPost(pushEnvelope('c1'));
    // Slack posts the 24h reminder: its queued id disappears on Slack's side.
    const [firstId] = [...world.slackQueue.keys()].sort();
    world.slackQueue.delete(firstId!);

    world.setWork('c1', [{ ...world.courses.get('c1')!.work[0]!, submissionState: 'TURNED_IN' }]);
    world.doPost(pushEnvelope('c1', { publishTime: Date.now() + 10_000, messageId: '2' }));

    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(0);
    expect(world.logMessages('sync')).not.toContain('Sync cycle failed for user');
    expect(world.slackQueue.size).toBe(0);
  });

  it('a push for a course nobody follows is a no-op sync (no Classroom traffic)', () => {
    world.doPost(pushEnvelope('c-unknown'));

    expect(world.callsTo('classroom.googleapis.com')).toEqual([]);
    expect(world.logMessages('push')).toEqual(['Push-triggered sync completed']);
  });
});

describe('push endpoint — hostile and broken input (anonymous web app)', () => {
  let world: AppsScriptWorld;
  beforeEach(() => {
    world = makeWorld();
  });

  function expectNoSync(): void {
    expect(world.callsTo('classroom.googleapis.com')).toEqual([]);
    expect(world.callsTo('slack.com')).toEqual([]);
    expect(world.table('Deliveries')).toEqual([]);
  }

  it.each([
    ['wrong token', 'not-the-token'],
    ['missing token', null],
    ['empty token', ''],
    ['token prefix', 'push-token'],
  ])('rejects a %s', (_label, token) => {
    expect(world.doPost(pushEnvelope('c1'), token)).toBeUndefined();
    expectNoSync();
    expect(world.logMessages('push')).toEqual(['Rejected push with missing or wrong token']);
  });

  it.each([
    ['empty body', ''],
    ['non-JSON body', '<html>hi</html>'],
    ['no message', '{}'],
    ['data not base64 JSON', JSON.stringify({ message: { data: '!!!notbase64', publishTime: new Date().toISOString() } })],
    ['no publishTime', JSON.stringify({ message: { data: Buffer.from('{}').toString('base64') } })],
    [
      'no courseId',
      JSON.stringify({
        message: { data: Buffer.from('{"resourceId":{}}').toString('base64'), publishTime: new Date().toISOString() },
      }),
    ],
    ['10MB of junk', 'x'.repeat(10_000_000)],
  ])('ignores a malformed push (%s) without syncing or throwing', (_label, body) => {
    expect(world.doPost(body)).toBeUndefined();
    expectNoSync();
    expect(world.logMessages('push')).toEqual(['Ignored malformed push body']);
  });

  it('a request with no postData at all is ignored as malformed', () => {
    expect(world.run('doPost', { parameter: { token: 'push-token-0123456789abcdef' } })).toBeUndefined();
    expectNoSync();
  });

  it('rejects everything, logging to console only, when PUSH_VERIFICATION_TOKEN is unset', () => {
    world.properties.delete('PUSH_VERIFICATION_TOKEN');

    expect(world.doPost(pushEnvelope('c1'))).toBeUndefined();

    expectNoSync();
    expect(world.consoleErrors).toHaveLength(1);
    expect(world.consoleErrors[0]).toContain('PUSH_VERIFICATION_TOKEN');
  });
});

describe('push sync — failures during a push-triggered sync', () => {
  let world: AppsScriptWorld;
  beforeEach(() => {
    world = makeWorld();
  });

  it('a Classroom outage skips that course without failing the sync or throwing', () => {
    world.classroomFailures.set('c1', 500);

    expect(world.doPost(pushEnvelope('c1'))).toBeUndefined();

    expect(world.logMessages('classroom')).toContain('Failed to fetch coursework for course, skipping it this cycle');
    expect(world.table('Deliveries')).toEqual([]);
  });

  it('a Slack outage counts toward the watchdog, and a redelivery is NOT treated as covered (G1)', () => {
    world.doPost(pushEnvelope('c1'));
    world.setWork('c1', [{ ...world.courses.get('c1')!.work[0]!, submissionState: 'TURNED_IN' }]);
    world.slackFailures.set('chat.deleteScheduledMessage', 'channel_not_found');
    const body = pushEnvelope('c1', { publishTime: Date.now() + 10_000, messageId: '2' });

    expect(world.doPost(body)).toBeUndefined();
    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(1);

    world.slackFailures.clear();
    world.doPost(body); // Pub/Sub redelivery of the same message

    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(0);
    expect(world.slackQueue.size).toBe(0);
  });

  it('two failures in a row DM an error alert', () => {
    world.doPost(pushEnvelope('c1'));
    world.setWork('c1', [{ ...world.courses.get('c1')!.work[0]!, submissionState: 'TURNED_IN' }]);
    world.slackFailures.set('chat.deleteScheduledMessage', 'channel_not_found');

    world.doPost(pushEnvelope('c1', { publishTime: Date.now() + 10_000, messageId: '2' }));
    world.doPost(pushEnvelope('c1', { publishTime: Date.now() + 20_000, messageId: '3' }));

    expect(world.slackPosted.some((t) => t.includes('Sync has now failed 2 times in a row'))).toBe(true);
  });
});

describe('push sync — lock contention (G2 catch-up)', () => {
  let world: AppsScriptWorld;
  beforeEach(() => {
    world = makeWorld();
    world.run('installAllTriggers');
  });

  const catchUpTriggers = () =>
    world.scriptApp.triggers.filter((t) => t.getHandlerFunction() === CATCH_UP_SYNC_FUNCTION);

  it('a push that hits a busy lock schedules exactly one catch-up, even in a burst', () => {
    world.lockBusy = true;

    for (let i = 0; i < 5; i++) world.doPost(pushEnvelope('c1', { messageId: String(i) }));

    expect(world.logMessages('push')).toEqual(Array(5).fill('Push-triggered sync skipped (lock busy)'));
    expect(catchUpTriggers()).toHaveLength(1);
    expect(world.table('Deliveries')).toEqual([]);
  });

  it('the catch-up runs a full sync and removes its own trigger', () => {
    world.lockBusy = true;
    world.doPost(pushEnvelope('c1'));
    world.lockBusy = false;

    world.run(CATCH_UP_SYNC_FUNCTION);

    expect(catchUpTriggers()).toHaveLength(0);
    expect(world.table('Deliveries')).toHaveLength(4);
    // The three regular triggers are untouched.
    expect(world.scriptApp.triggers).toHaveLength(3);
  });

  it('a catch-up that still finds the lock busy re-arms itself', () => {
    world.lockBusy = true;
    world.doPost(pushEnvelope('c1'));

    world.run(CATCH_UP_SYNC_FUNCTION);

    expect(catchUpTriggers()).toHaveLength(1);
  });
});

describe('renewPushRegistrations through the shipped bundle', () => {
  it('registers every followed course against PUBSUB_TOPIC and records them', () => {
    const world = makeWorld();

    world.run('renewPushRegistrations');

    const creates = world.callsTo('/registrations').filter((c) => c.method === 'post');
    expect(creates.map((c) => c.params['feed.courseWorkChangesInfo.courseId']).sort()).toEqual(['c1', 'c2']);
    expect(creates.every((c) => c.params['feed.feedType'] === 'COURSE_WORK_CHANGES')).toBe(true);
    expect(creates.every((c) => c.params['cloudPubsubTopic.topicName'] === TOPIC)).toBe(true);
    expect(world.table('Registrations').map((r) => r.course_id).sort()).toEqual(['c1', 'c2']);
  });

  it('is idempotent: a second run the same day creates nothing new', () => {
    const world = makeWorld();
    world.run('renewPushRegistrations');
    world.resetCalls();

    world.run('renewPushRegistrations');

    expect(world.callsTo('/registrations')).toEqual([]);
    expect(world.table('Registrations')).toHaveLength(2);
  });

  it('a PERMISSION_DENIED registration (student not allowed) keeps the others and DMs one alert', () => {
    const world = makeWorld();
    world.registrationFailures.set('c1', 403);

    world.run('renewPushRegistrations');

    expect(world.table('Registrations').map((r) => r.course_id)).toEqual(['c2']);
    const alerts = world.slackPosted.filter((t) => t.includes('c1'));
    expect(alerts).toHaveLength(1);
  });
});
