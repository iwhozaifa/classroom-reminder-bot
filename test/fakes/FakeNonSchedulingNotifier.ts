import type { ChannelId, Delivery } from '../../src/core/types.js';
import type { Notifier } from '../../src/ports/Notifier.js';

/**
 * Mirrors the future CallMeBot/WhatsApp shape: no native scheduling API at all, so
 * `schedule`/`cancel` must never be reached — the orchestrator is contractually
 * required to check `supportsScheduling` first. Throwing here, rather than being
 * silently correct, is what makes a wiring bug in the orchestrator fail loudly.
 */
export class FakeNonSchedulingNotifier implements Notifier {
  readonly channelId: ChannelId = 'whatsapp';
  readonly supportsScheduling = false;

  readonly sentNow: Delivery[] = [];

  schedule(): never {
    throw new Error('schedule() must never be called on a non-scheduling channel');
  }

  cancel(): never {
    throw new Error('cancel() must never be called on a non-scheduling channel');
  }

  sendNow(delivery: Delivery, _text: string): string | null {
    this.sentNow.push(delivery);
    return null; // CallMeBot has no message-id concept — 'sent' status is the only signal.
  }
}
