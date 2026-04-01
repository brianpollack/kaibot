import { afterEach, describe, expect, it, vi } from "vitest";

import { routeToolUse } from "../KaiAgent.js";
import { uiStore } from "../ui/store.js";

// ---------------------------------------------------------------------------
// Tests — routeToolUse emits "package-json-changed" for package.json edits
// ---------------------------------------------------------------------------

describe("routeToolUse — package-json-changed event", () => {
  afterEach(() => {
    uiStore.removeAllListeners("package-json-changed");
  });

  it("emits package-json-changed when Write targets package.json", () => {
    const spy = vi.fn();
    uiStore.on("package-json-changed", spy);

    routeToolUse("Write", { file_path: "/some/project/package.json", content: "{}" });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("emits package-json-changed when Edit targets package.json", () => {
    const spy = vi.fn();
    uiStore.on("package-json-changed", spy);

    routeToolUse("Edit", {
      file_path: "/some/project/package.json",
      old_string: '"foo": "bar"',
      new_string: '"foo": "baz"',
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT emit package-json-changed for Read of package.json", () => {
    const spy = vi.fn();
    uiStore.on("package-json-changed", spy);

    routeToolUse("Read", { file_path: "/some/project/package.json" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT emit package-json-changed for Write to other files", () => {
    const spy = vi.fn();
    uiStore.on("package-json-changed", spy);

    routeToolUse("Write", { file_path: "/some/project/src/index.ts", content: "hello" });

    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT emit for a file named like package.json.bak", () => {
    const spy = vi.fn();
    uiStore.on("package-json-changed", spy);

    routeToolUse("Write", { file_path: "/some/project/package.json.bak", content: "{}" });

    expect(spy).not.toHaveBeenCalled();
  });
});
