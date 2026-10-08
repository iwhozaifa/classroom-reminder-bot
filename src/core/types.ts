// Pure domain types. No Apps Script globals, no I/O — see CLAUDE.md's module-boundary rule.

/** Epoch milliseconds, UTC. Every instant in core is this — never a Date object. */
export type Instant = number;

export type SubmissionState = 'NEW' | 'CREATED' | 'TURNED_IN' | 'RECLAIMED_BY_STUDENT' | 'RETURNED';

/** Mirrors Classroom's courseWork.dueDate shape exactly (year/month/day, 1-indexed month). */
export interface DueDateParts {
  year: number;
  month: number;
  day: number;
}

/** Mirrors Classroom's courseWork.dueTime shape. Already UTC per the Classroom API reference. */
export interface DueTimeParts {
  hours: number;
  minutes: number;
}

export interface Assignment {
  courseId: string;
  assignmentId: string;
  title: string;
  submissionState: SubmissionState;
  postedAt: Instant;
  /** null = no due date was ever set for this assignment. */
  dueDate: DueDateParts | null;
  /** Only meaningful when dueDate is non-null; null means "date but no specific time". */
  dueTime: DueTimeParts | null;
}

/** What reconcile() needs about the user — course allow-list and channel config live outside core. */
export interface UserConfig {
  userId: string;
  timezone: string; // IANA zone name
  rollingWindowDays: number;
}

export type ReminderType = '24h' | '12h' | '2h' | '1h' | 'daily';

/**
 * Channel-agnostic: what should be reminded about, and when. One row models one
 * (assignment, offset) pair. Per-channel delivery facts (status, external id) live
 * on Delivery instead — see planDeliveries.ts.
 */
export interface Reminder {
  userId: string;
  assignmentId: string;
  courseId: string;
  title: string;
  reminderType: ReminderType;
  dueAt: Instant | null;
  fireAt: Instant;
  submissionStateSnapshot: SubmissionState;
}

export type ReminderChangeKind = 'create' | 'remove';
export interface ReminderChange {
  kind: ReminderChangeKind;
  reminder: Reminder;
}

/** An open set in principle; 'slack' is the only real value in v1. */
export type ChannelId = string;

export type DeliveryStatus = 'pending' | 'scheduled' | 'sent' | 'cancelled' | 'failed';

/** One row per (reminder, channel). This is the piece the multi-channel design added. */
export interface Delivery {
  userId: string;
  assignmentId: string;
  reminderType: ReminderType;
  /** Own copy, not just inherited — lets a future channel use a different offset from the parent Reminder. */
  fireAt: Instant;
  channel: ChannelId;
  status: DeliveryStatus;
  /** Null until a scheduling channel confirms a handle, and stays null forever for channels with no such concept. */
  externalMessageId: string | null;
}

/** The only fact core is allowed to branch on for a channel — never its name. */
export interface ChannelCapabilities {
  supportsScheduling: boolean;
}

export type DeliveryChangeKind = 'create' | 'cancel' | 'markSent' | 'markFailed';
export interface DeliveryChange {
  kind: DeliveryChangeKind;
  delivery: Delivery;
}

/**
 * What the orchestrator must actually call on a Notifier. planDeliveries() only ever
 * emits 'scheduleCreate' | 'scheduleCancel' | 'dispatchSendNow' — a "reschedule" is
 * just a scheduleCancel + scheduleCreate pair (Slack has no in-place reschedule
 * endpoint, confirmed in M0), so there's no separate "replace" kind.
 */
export type NotifierActionKind = 'scheduleCreate' | 'scheduleCancel' | 'dispatchSendNow';
export interface NotifierAction {
  kind: NotifierActionKind;
  delivery: Delivery;
}
