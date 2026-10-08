import type { Delivery, DeliveryChange } from '../core/types.js';

export interface DeliveryStore {
  loadDeliveries(userId: string): Delivery[];
  applyChanges(changes: DeliveryChange[]): void;
}
