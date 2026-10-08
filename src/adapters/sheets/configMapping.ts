// Pure array<->object mapping for the Config tab, same split as rowMapping.ts.
// v1 only ever has one data row, but the schema (and this mapping) stays
// multi-row-ready — see the plan's Sheet Schema section.

export interface StoredUserConfig {
  userId: string;
  displayName: string;
  timezone: string;
  courseIds: string[];
  activeChannels: string[];
  rollingWindowDays: number;
  consecutiveFailureCount: number;
  active: boolean;
}

/** Column order mirrors schema.ts's CONFIG_HEADERS exactly. slack_* and quiet_hours_* columns
 * are schema-only in v1 (Slack identity lives in Script Properties; quiet hours are unenforced
 * per the plan's Out-of-Scope section) so they're carried through unparsed, not modeled here. */
export function rowToConfig(row: unknown[]): StoredUserConfig {
  return {
    userId: String(row[0]),
    displayName: String(row[1]),
    timezone: String(row[2]),
    courseIds: parseList(row[3]),
    activeChannels: parseList(row[4]),
    rollingWindowDays: parseNumber(row[10], 7),
    consecutiveFailureCount: parseNumber(row[11], 0),
    active: parseBoolean(row[12]),
  };
}

/** Writes back only the fields this bot actually manages; every other column is passed through untouched. */
export function applyConfigPatch(row: unknown[], patch: Partial<StoredUserConfig>): unknown[] {
  const next = [...row];
  if (patch.courseIds !== undefined) next[3] = patch.courseIds.join(',');
  if (patch.activeChannels !== undefined) next[4] = patch.activeChannels.join(',');
  if (patch.rollingWindowDays !== undefined) next[10] = patch.rollingWindowDays;
  if (patch.consecutiveFailureCount !== undefined) next[11] = patch.consecutiveFailureCount;
  if (patch.active !== undefined) next[12] = patch.active;
  return next;
}

function parseList(cell: unknown): string[] {
  if (cell === '' || cell === null || cell === undefined) return [];
  return String(cell)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseNumber(cell: unknown, fallback: number): number {
  if (cell === '' || cell === null || cell === undefined) return fallback;
  const n = Number(cell);
  return Number.isFinite(n) ? n : fallback;
}

/** A Sheet checkbox cell comes back as a real boolean; a plain typed cell comes back as text. */
function parseBoolean(cell: unknown): boolean {
  if (typeof cell === 'boolean') return cell;
  return String(cell).trim().toUpperCase() === 'TRUE';
}
