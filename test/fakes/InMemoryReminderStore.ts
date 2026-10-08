import type { Reminder, ReminderChange } from '../../src/core/types.js';
import type { ReminderStore } from '../../src/ports/ReminderStore.js';

/** Mirrors the real Sheet's key — see reconcile.ts's reminderKey for why fireAt is part of it. */
function reminderKey(r: Pick<Reminder, 'assignmentId' | 'reminderType' | 'fireAt'>): string {
  return `${r.assignmentId}:${r.reminderType}:${r.fireAt}`;
}

export class InMemoryReminderStore implements ReminderStore {
  private readonly rows = new Map<string, Reminder>();

  loadReminders(userId: string): Reminder[] {
    return [...this.rows.values()].filter((r) => r.userId === userId);
  }

  applyChanges(changes: ReminderChange[]): void {
    for (const change of changes) {
      const key = reminderKey(change.reminder);
      if (change.kind === 'create') this.rows.set(key, change.reminder);
      else this.rows.delete(key);
    }
  }
}
