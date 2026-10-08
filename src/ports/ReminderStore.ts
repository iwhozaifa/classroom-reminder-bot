import type { Reminder, ReminderChange } from '../core/types.js';

export interface ReminderStore {
  loadReminders(userId: string): Reminder[];
  applyChanges(changes: ReminderChange[]): void;
}
