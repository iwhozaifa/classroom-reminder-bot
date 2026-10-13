import type { Registration } from '../core/types.js';

export interface RegistrationStore {
  load(): Registration[];
  /** Full-state write, same as every other tab — the renewal job always knows the whole set. */
  replaceAll(registrations: Registration[]): void;
}
