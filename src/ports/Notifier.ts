import type { ChannelId, Delivery, Instant } from '../core/types.js';

/**
 * One interface for every channel — capability flag, not a class per channel. The
 * orchestrator is contractually required to check `supportsScheduling` before ever
 * calling `schedule`/`cancel`; an implementation with `supportsScheduling: false`
 * (e.g. a future CallMeBot/WhatsApp adapter) is allowed to make those two throw,
 * since they must never be reached. See the plan's "Multi-channel Design" section.
 */
export interface Notifier {
  readonly channelId: ChannelId;
  readonly supportsScheduling: boolean;

  /** Only ever called when `supportsScheduling` is true. Returns the external message id. */
  schedule(delivery: Delivery, text: string, fireAt: Instant): string;

  /** Only ever called when `supportsScheduling` is true. */
  cancel(externalMessageId: string): void;

  /** The only method a non-scheduling channel implements for real. Null id = no such concept (e.g. CallMeBot). */
  sendNow(delivery: Delivery, text: string): string | null;
}
