import type { Registration } from '../core/types.js';

/** Creates/deletes Classroom push-notification registrations — see core/registrations.ts. */
export interface PushRegistrar {
  register(courseId: string, topicName: string): Registration;
  /** Must treat "already gone" as success — expired registrations vanish on their own. */
  unregister(registrationId: string): void;
}
