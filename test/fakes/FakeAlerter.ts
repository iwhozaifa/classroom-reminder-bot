import type { ErrorAlerter } from '../../src/triggers/syncReminders.js';
import type { HeartbeatSender } from '../../src/triggers/heartbeat.js';

/** Satisfies both narrow Slack-specific-extras interfaces, same as the real SlackNotifier does. */
export class FakeAlerter implements ErrorAlerter, HeartbeatSender {
  readonly errorAlerts: string[] = [];
  readonly heartbeats: string[] = [];
  private shouldThrow = false;

  throwOnNextAlert(): void {
    this.shouldThrow = true;
  }

  sendErrorAlert(text: string): void {
    if (this.shouldThrow) {
      this.shouldThrow = false;
      throw new Error('FakeAlerter: simulated send failure');
    }
    this.errorAlerts.push(text);
  }

  sendHeartbeat(text: string): void {
    this.heartbeats.push(text);
  }
}
