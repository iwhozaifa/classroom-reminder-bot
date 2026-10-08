import type { ChannelId, Delivery, Instant } from '../../src/core/types.js';
import type { Notifier } from '../../src/ports/Notifier.js';

/** Mirrors Slack: supports native scheduling, has real create/cancel handles. */
export class FakeSchedulingNotifier implements Notifier {
  readonly channelId: ChannelId = 'slack';
  readonly supportsScheduling = true;

  readonly scheduled = new Map<string, Delivery>();
  readonly cancelled: string[] = [];
  readonly sentNow: Delivery[] = [];

  private nextId = 1;

  schedule(delivery: Delivery, _text: string, _fireAt: Instant): string {
    const id = `slack-msg-${this.nextId++}`;
    this.scheduled.set(id, delivery);
    return id;
  }

  cancel(externalMessageId: string): void {
    if (!this.scheduled.delete(externalMessageId)) {
      throw new Error(`cancel() called with an unknown externalMessageId: ${externalMessageId}`);
    }
    this.cancelled.push(externalMessageId);
  }

  sendNow(delivery: Delivery, _text: string): string | null {
    this.sentNow.push(delivery);
    return `slack-msg-${this.nextId++}`;
  }
}
