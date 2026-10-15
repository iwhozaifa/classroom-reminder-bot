import { beforeEach, describe, expect, it } from 'vitest';
import { HEARTBEAT_TRIGGER_FUNCTION, SYNC_SWEEP_HOURS, SYNC_TRIGGER_FUNCTION } from '../../src/triggers/onInstall.js';
import { AppsScriptWorld } from './bundleHarness.js';

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

function turnIn(world: AppsScriptWorld, state = 'TURNED_IN'): void {
  world.setWork('c1', [{ ...world.courses.get('c1')!.work[0]!, submissionState: state }]);
}

describe('syncReminders through the shipped bundle', () => {
  let world: AppsScriptWorld;
  beforeEach(() => {
    world = makeWorld();
  });

  const sync = (): unknown => world.run(SYNC_TRIGGER_FUNCTION);

  it('reads every followed course and schedules readable reminders', () => {
    expect(sync()).toBeUndefined();

    expect(world.callsTo('/courses/c1/courseWork?')).toHaveLength(1);
    expect(world.callsTo('/courses/c2/courseWork?')).toHaveLength(1);

    const deliveries = world.table('Deliveries');
    expect(deliveries.map((d) => d.reminder_type).sort()).toEqual(['12h', '1h', '24h', '2h']);
    expect(deliveries.every((d) => d.status === 'scheduled' && String(d.external_message_id).startsWith('Q'))).toBe(true);
    expect(world.slackQueue.size).toBe(4);

    const text = [...world.slackQueue.values()][0]!.text;
    expect(text).toContain(':books: *Software Engineering* — Lab 4: Binary Trees');
    expect(text).toMatch(/\nDue \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} [AP]M \(in \d+h( \d+m)?\)/);
    expect(text).toContain('<https://classroom.google.com/c/c1/a/cw-1/details|Open in Classroom>');

    expect(world.properties.get('SLACK_DM_CHANNEL_ID')).toBe('D12345678');
    expect(world.logMessages('sync')).toEqual(['Sync cycle completed']);
  });

  it('a second sweep with nothing changed sends nothing to Slack', () => {
    sync();
    world.resetCalls();

    sync();

    expect(world.callsTo('slack.com')).toEqual([]);
    expect(world.slackQueue.size).toBe(4);
  });

  it('picks up a newly posted assignment on the next sweep', () => {
    sync();
    world.setWork('c1', [
      ...world.courses.get('c1')!.work,
      { id: 'cw-2', title: 'Quiz 2', dueAt: Date.now() + 30 * HOUR, submissionState: 'NEW' },
    ]);

    sync();

    expect(world.table('Deliveries').filter((d) => d.assignment_id === 'cw-2')).toHaveLength(4);
  });

  it('turning work in cancels every pending reminder for it', () => {
    sync();
    turnIn(world);

    sync();

    expect(world.slackQueue.size).toBe(0);
    expect(world.callsTo('chat.deleteScheduledMessage')).toHaveLength(4);
    expect(world.table('Deliveries').every((d) => d.status === 'cancelled')).toBe(true);
    expect(world.table('Reminders')).toEqual([]);
  });

  it('unsubmitting re-schedules the reminders that are still ahead', () => {
    sync();
    turnIn(world);
    sync();

    turnIn(world, 'RECLAIMED_BY_STUDENT');
    sync();

    expect(world.slackQueue.size).toBe(4);
    expect(world.table('Deliveries').filter((d) => d.status === 'scheduled')).toHaveLength(4);
  });

  it('turning in after Slack already posted a reminder never fails the sync (ADR 14)', () => {
    sync();
    // Slack posts the 24h reminder: its queued id disappears on Slack's side.
    const [firstId] = [...world.slackQueue.keys()].sort();
    world.slackQueue.delete(firstId!);
    turnIn(world);

    sync();

    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(0);
    expect(world.logMessages('sync')).not.toContain('Sync cycle failed for user');
    expect(world.slackQueue.size).toBe(0);
  });

  it('a Classroom outage skips that course without failing the sync', () => {
    world.classroomFailures.set('c1', 500);

    expect(sync()).toBeUndefined();

    expect(world.logMessages('classroom')).toContain('Failed to fetch coursework for course, skipping it this cycle');
    expect(world.table('Deliveries')).toEqual([]);
    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(0);
  });

  it('a Slack failure counts toward the watchdog, DMs an alert on the second, and recovers', () => {
    sync();
    turnIn(world);
    world.slackFailures.set('chat.deleteScheduledMessage', 'channel_not_found');

    sync();
    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(1);
    sync();
    expect(world.slackPosted.some((t) => t.includes('Sync has now failed 2 times in a row'))).toBe(true);

    world.slackFailures.clear();
    sync();

    expect(world.table('Config')[0]!.consecutive_failure_count).toBe(0);
    expect(world.slackQueue.size).toBe(0);
  });

  it('skips and logs when another execution holds the lock', () => {
    world.lockBusy = true;

    sync();

    expect(world.logMessages('sync')).toEqual(['Lock not acquired, skipping this cycle']);
    expect(world.callsTo('classroom.googleapis.com')).toEqual([]);
  });

  it('a missing Script Property fails loudly (the Executions log shows it)', () => {
    world.properties.delete('SLACK_BOT_TOKEN');

    expect(() => sync()).toThrow('Script Property SLACK_BOT_TOKEN is not set.');
  });
});

describe('purgeOrphanScheduledMessages through the shipped bundle', () => {
  it('deletes queued messages no Deliveries row owns and keeps the rest', () => {
    const world = makeWorld();
    world.run(SYNC_TRIGGER_FUNCTION);
    // Duplicates left behind by the old failure loop: queued in Slack, never recorded.
    world.slackQueue.set('Q-dup-1', { id: 'Q-dup-1', postAt: 1, text: 'Reminder: cw-1 (24h)' });
    world.slackQueue.set('Q-dup-2', { id: 'Q-dup-2', postAt: 2, text: 'Reminder: cw-1 (12h)' });

    world.run('purgeOrphanScheduledMessages');

    expect([...world.slackQueue.keys()].sort()).toEqual(
      world.table('Deliveries').map((d) => String(d.external_message_id)).sort(),
    );
    expect(world.logMessages('purge')).toEqual(['Deleted orphaned scheduled Slack messages']);
  });
});

describe('installAllTriggers through the shipped bundle', () => {
  it('installs exactly the 4-hour sweep and the daily heartbeat, replacing an old 10-minute trigger', () => {
    const world = makeWorld();
    world.scriptApp.newTrigger(SYNC_TRIGGER_FUNCTION).timeBased().everyMinutes(10).create();

    world.run('installAllTriggers');

    const triggers = world.scriptApp.triggers;
    expect(triggers.map((t) => t.getHandlerFunction()).sort()).toEqual(
      [HEARTBEAT_TRIGGER_FUNCTION, SYNC_TRIGGER_FUNCTION].sort(),
    );
    const sweep = triggers.find((t) => t.getHandlerFunction() === SYNC_TRIGGER_FUNCTION)!;
    expect(sweep.everyHoursValue).toBe(SYNC_SWEEP_HOURS);
    expect(sweep.everyMinutesValue).toBe(0);
  });
});
