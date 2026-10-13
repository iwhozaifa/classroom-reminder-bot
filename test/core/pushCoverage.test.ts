import { describe, expect, it } from 'vitest';
import { isCoveredBySync } from '../../src/core/pushCoverage.js';

const T = Date.UTC(2026, 0, 1);
const MARGIN = 5_000;

describe('isCoveredBySync', () => {
  it('is never covered when no sync start has been recorded', () => {
    expect(isCoveredBySync(T, null, MARGIN)).toBe(false);
  });

  it('is covered when a sync started at least marginMs after the change was published', () => {
    expect(isCoveredBySync(T, T + MARGIN, MARGIN)).toBe(true);
    expect(isCoveredBySync(T, T + 60_000, MARGIN)).toBe(true);
  });

  it('is not covered when the last sync started inside the margin — Classroom may not have shown the change yet', () => {
    expect(isCoveredBySync(T, T + MARGIN - 1, MARGIN)).toBe(false);
  });

  it('is not covered when the change was published after the last sync started', () => {
    expect(isCoveredBySync(T, T - 1, MARGIN)).toBe(false);
  });
});
