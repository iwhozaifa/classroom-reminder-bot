import type { Instant } from '../types.js';

export interface CatchUpCandidate {
  key: string;
  fireAt: Instant;
  dueAt: Instant | null;
}

/**
 * Rule 7's core predicate, reused by planDeliveries.ts for two different purposes:
 *  - a scheduling channel (Slack) whose `schedule()` call itself never went through
 *    in time (status still 'pending'/'failed' once fireAt has passed) — the rare
 *    fallback case, since Slack normally delivers independently of Apps Script uptime.
 *  - a non-scheduling channel (e.g. a future WhatsApp/CallMeBot), for which THIS is
 *    the *only* dispatch path — every delivery goes through it, every cycle.
 *
 * A delivery is due for an immediate send only if its fire time has arrived and the
 * assignment's due time (if any) has not — once the due time itself has passed,
 * reminding about it is no longer useful, so no send happens at all.
 */
export function isDueForImmediateSend(candidate: CatchUpCandidate, now: Instant): boolean {
  if (candidate.fireAt > now) return false;
  if (candidate.dueAt !== null && candidate.dueAt <= now) return false;
  return true;
}

export interface CatchUpAction {
  send: string | null;
  cancel: string[];
}

/**
 * Among every live candidate for one (assignment, channel) pair, at most one ever
 * sends — the most urgent (latest `fireAt`, i.e. the offset closest to the due
 * time). The rest are cancelled outright so a backlog never turns into a burst of
 * redundant messages.
 */
export function pickCatchUpAction(candidates: CatchUpCandidate[], now: Instant): CatchUpAction {
  const eligible = candidates.filter((candidate) => isDueForImmediateSend(candidate, now));
  if (eligible.length === 0) return { send: null, cancel: [] };

  const [winner, ...rest] = [...eligible].sort((a, b) => b.fireAt - a.fireAt);
  return { send: winner!.key, cancel: rest.map((c) => c.key) };
}
