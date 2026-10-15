// Single source of truth for tab names and header rows — shared by setupSheet
// (creates/verifies them), SheetReminderStore (reads/writes by column position),
// and SheetLogger. Column order here IS the column order on the real Sheet.

export const REMINDERS_SHEET_NAME = 'Reminders';
export const DELIVERIES_SHEET_NAME = 'Deliveries';
export const CONFIG_SHEET_NAME = 'Config';
export const LOG_SHEET_NAME = 'Log';

export const REMINDERS_HEADERS = [
  'user_id',
  'assignment_id',
  'course_id',
  'title',
  'reminder_type',
  'due_at',
  'fire_at',
  'submission_state_snapshot',
  'created_at',
  'last_synced',
] as const;

export const DELIVERIES_HEADERS = [
  'user_id',
  'assignment_id',
  'reminder_type',
  'channel',
  'status',
  'fire_at',
  'external_message_id',
  'last_attempt_at',
  'last_synced',
] as const;

// Not yet read/written by any Store this milestone (M6/M7 wire the real UserConfig
// load path) — created now so a fresh install gets all four tabs in one setup pass.
export const CONFIG_HEADERS = [
  'user_id',
  'display_name',
  'timezone',
  'course_ids',
  'active_channels',
  'slack_user_id',
  'slack_dm_channel_id',
  'quiet_hours_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
  'rolling_window_days',
  'consecutive_failure_count',
  'active',
] as const;

export const LOG_HEADERS = ['timestamp', 'level', 'source', 'message', 'context_json'] as const;
