// Entry point bundled by esbuild into dist/Code.js. Apps Script invokes trigger
// functions by global name, and the IIFE bundle gives each module its own closure
// — so once src/triggers exists (M7), those entry points get attached here via
// `(globalThis as Record<string, unknown>).syncReminders = syncReminders;` etc.
export const BOOTSTRAP_VERSION = '0.1.0';
