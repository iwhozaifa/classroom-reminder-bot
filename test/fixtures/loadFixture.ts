import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Loads a fixture JSON file by path relative to test/fixtures/. */
export function loadFixture(relativePath: string): unknown {
  const fullPath = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}
