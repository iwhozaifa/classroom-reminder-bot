import { describe, expect, it } from 'vitest';
import { isDueForImmediateSend, pickCatchUpAction } from '../../src/core/rules/catchUp.js';

const NOW = Date.UTC(2026, 0, 15, 12, 0);

describe('isDueForImmediateSend', () => {
  it('is false when the fire time has not arrived yet', () => {
    expect(isDueForImmediateSend({ key: 'a', fireAt: NOW + 1000, dueAt: null }, NOW)).toBe(false);
  });

  it('is true when fire time has passed and there is no due date', () => {
    expect(isDueForImmediateSend({ key: 'a', fireAt: NOW - 1000, dueAt: null }, NOW)).toBe(true);
  });

  it('is true when fire time has passed and the due date is still in the future', () => {
    expect(isDueForImmediateSend({ key: 'a', fireAt: NOW - 1000, dueAt: NOW + 1000 }, NOW)).toBe(true);
  });

  it('is false once the due date itself has also passed — no point reminding about it anymore', () => {
    expect(isDueForImmediateSend({ key: 'a', fireAt: NOW - 2000, dueAt: NOW - 1000 }, NOW)).toBe(false);
  });
});

describe('pickCatchUpAction', () => {
  it('sends nothing when no candidate is eligible yet', () => {
    expect(pickCatchUpAction([{ key: 'a', fireAt: NOW + 1000, dueAt: null }], NOW)).toEqual({
      send: null,
      cancel: [],
    });
  });

  it('sends the single eligible candidate', () => {
    expect(pickCatchUpAction([{ key: 'a', fireAt: NOW - 1000, dueAt: null }], NOW)).toEqual({
      send: 'a',
      cancel: [],
    });
  });

  it('sends only the most urgent (latest fireAt) among several eligible candidates, cancelling the rest', () => {
    const candidates = [
      { key: '24h', fireAt: NOW - 10_000, dueAt: null },
      { key: '12h', fireAt: NOW - 5_000, dueAt: null },
      { key: '1h', fireAt: NOW - 1_000, dueAt: null },
    ];
    const result = pickCatchUpAction(candidates, NOW);
    expect(result.send).toBe('1h');
    expect(result.cancel.sort()).toEqual(['12h', '24h']);
  });

  it('never sends a candidate whose due date has already passed', () => {
    expect(pickCatchUpAction([{ key: 'a', fireAt: NOW - 1000, dueAt: NOW - 500 }], NOW)).toEqual({
      send: null,
      cancel: [],
    });
  });
});
