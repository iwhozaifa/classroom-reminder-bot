/** Injectable seam over LockService so the overlap-protection logic in syncReminders.ts is testable without it. */
export interface Lock {
  /** Returns false instead of throwing when the lock isn't free within timeoutMs — mirrors LockService.Lock.tryLock. */
  tryAcquire(timeoutMs: number): boolean;
  release(): void;
}

export class ScriptServiceLock implements Lock {
  private readonly lock = LockService.getScriptLock();

  tryAcquire(timeoutMs: number): boolean {
    return this.lock.tryLock(timeoutMs);
  }

  release(): void {
    this.lock.releaseLock();
  }
}
