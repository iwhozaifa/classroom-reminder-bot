import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_VERSION } from '../src/main.js';

describe('M1 scaffold', () => {
  it('builds and imports src/main without an Apps Script runtime present', () => {
    expect(BOOTSTRAP_VERSION).toBe('0.1.0');
  });
});
