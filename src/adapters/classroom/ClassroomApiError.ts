/**
 * Classroom REST errors come back as a non-2xx HTTP status with a JSON body
 * (`{ error: { code, message, status } }`) — unlike Slack, which always answers
 * 200 and signals failure in the body. So this carries the HTTP status plus
 * whatever Classroom's own `status` string was (e.g. 'NOT_FOUND', 'PERMISSION_DENIED').
 */
export class ClassroomApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly classroomStatus: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ClassroomApiError';
  }
}
