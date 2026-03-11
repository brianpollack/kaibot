import React from "react";
import { render as inkRender, type Instance } from "ink";

import { App } from "./App.js";

// ---------------------------------------------------------------------------
// Ink renderer — singleton
// ---------------------------------------------------------------------------

let instance: Instance | null = null;

/**
 * Mount the Ink application. Call once at startup.
 * Returns the Ink instance so callers can unmount/waitUntilExit.
 */
export function mountUI(): Instance {
  if (instance) return instance;

  // Clear the screen so KaiBot owns the full terminal
  process.stdout.write("\x1B[2J\x1B[H");

  instance = inkRender(React.createElement(App));
  return instance;
}

/**
 * Unmount the Ink application and restore the terminal.
 */
export function unmountUI(): void {
  if (instance) {
    instance.unmount();
    instance = null;
  }
}
