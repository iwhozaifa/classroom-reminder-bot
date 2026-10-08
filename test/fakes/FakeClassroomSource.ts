import type { Assignment } from '../../src/core/types.js';
import type { ClassroomSource } from '../../src/ports/ClassroomSource.js';

export class FakeClassroomSource implements ClassroomSource {
  private readonly assignmentsByCourse = new Map<string, Assignment[]>();

  setAssignments(courseId: string, assignments: Assignment[]): void {
    this.assignmentsByCourse.set(courseId, assignments);
  }

  listAssignments(_userId: string, courseIds: string[]): Assignment[] {
    return courseIds.flatMap((id) => this.assignmentsByCourse.get(id) ?? []);
  }
}
