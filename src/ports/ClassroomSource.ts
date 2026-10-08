import type { Assignment } from '../core/types.js';

/** The only read Classroom supplies to core — paginated fetch/join happens in the adapter. */
export interface ClassroomSource {
  listAssignments(userId: string, courseIds: string[]): Assignment[];
}
