import type { Delivery, DeliveryChange } from '../../src/core/types.js';
import type { DeliveryStore } from '../../src/ports/DeliveryStore.js';

/** Mirrors planDeliveries.ts's deliveryKey — channel is part of the key, fireAt too. */
function deliveryKey(d: Pick<Delivery, 'assignmentId' | 'reminderType' | 'fireAt' | 'channel'>): string {
  return `${d.assignmentId}:${d.reminderType}:${d.fireAt}:${d.channel}`;
}

export class InMemoryDeliveryStore implements DeliveryStore {
  private readonly rows = new Map<string, Delivery>();

  loadDeliveries(userId: string): Delivery[] {
    return [...this.rows.values()].filter((d) => d.userId === userId);
  }

  applyChanges(changes: DeliveryChange[]): void {
    for (const change of changes) {
      const key = deliveryKey(change.delivery);
      // A cancelled row stays in the store (status flips to 'cancelled') rather than
      // being deleted — planDeliveries() needs to see terminal rows to skip them.
      const row = change.kind === 'cancel' ? { ...change.delivery, status: 'cancelled' as const } : change.delivery;
      this.rows.set(key, row);
    }
  }
}
