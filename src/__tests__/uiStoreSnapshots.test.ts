import { beforeEach, describe, expect, it } from "vitest";

import { uiStore } from "../ui/store.js";

// ---------------------------------------------------------------------------
// Helper: reset store state between tests
// ---------------------------------------------------------------------------

function resetStore(): void {
  uiStore.resetFeature();
  uiStore.startConversation(); // clears conversationItems
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UIStore snapshot methods", () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // getConversationSnapshot
  // -------------------------------------------------------------------------

  describe("getConversationSnapshot", () => {
    it("returns an empty array when no conversation items exist", () => {
      const snapshot = uiStore.getConversationSnapshot();
      expect(snapshot).toEqual([]);
    });

    it("returns entries with ISO 8601 timestamps", () => {
      uiStore.pushConversationThinking("Analyzing the codebase…");
      uiStore.pushConversationCommand("npm run build");

      const snapshot = uiStore.getConversationSnapshot();
      expect(snapshot.length).toBe(2);

      for (const entry of snapshot) {
        expect(entry.timestamp).toBeDefined();
        // ISO 8601 format check
        expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      }
    });

    it("preserves conversation item types and content", () => {
      uiStore.pushConversationThinking("Thinking about the problem…");
      uiStore.pushConversationCommand("git status");
      uiStore.pushConversationSystem("✅ Feature complete");

      const snapshot = uiStore.getConversationSnapshot();
      expect(snapshot).toHaveLength(3);
      expect(snapshot[0].type).toBe("thinking");
      expect(snapshot[0].content).toContain("Thinking about");
      expect(snapshot[1].type).toBe("command");
      expect(snapshot[1].content).toBe("git status");
      expect(snapshot[2].type).toBe("system");
      expect(snapshot[2].content).toContain("Feature complete");
    });

    it("includes agentType and agentDescription for agent items", () => {
      uiStore.pushConversationAgent("Explore", "Search for files", "Find all *.ts files");

      const snapshot = uiStore.getConversationSnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].type).toBe("agent");
      expect(snapshot[0].agentType).toBe("Explore");
      expect(snapshot[0].agentDescription).toBe("Search for files");
      expect(snapshot[0].content).toBe("Find all *.ts files");
    });
  });

  // -------------------------------------------------------------------------
  // getFileActivitySnapshot
  // -------------------------------------------------------------------------

  describe("getFileActivitySnapshot", () => {
    it("returns an empty array when no file ops exist", () => {
      const snapshot = uiStore.getFileActivitySnapshot();
      expect(snapshot).toEqual([]);
    });

    it("returns entries with ISO 8601 timestamps", () => {
      uiStore.pushFileOp({ type: "read", path: "foo.ts", preview: "" });
      uiStore.pushFileOp({ type: "write", path: "bar.ts", preview: "content…" });

      const snapshot = uiStore.getFileActivitySnapshot();
      expect(snapshot).toHaveLength(2);

      for (const entry of snapshot) {
        expect(entry.timestamp).toBeDefined();
        expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
      }
    });

    it("preserves file op types, paths, and previews", () => {
      uiStore.pushFileOp({ type: "edit", path: "src/main.ts", preview: "old code" });

      const snapshot = uiStore.getFileActivitySnapshot();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].type).toBe("edit");
      expect(snapshot[0].path).toBe("src/main.ts");
      expect(snapshot[0].preview).toBe("old code");
    });
  });

  // -------------------------------------------------------------------------
  // FileOp timestamp auto-population
  // -------------------------------------------------------------------------

  describe("FileOp timestamp", () => {
    it("auto-populates timestamp when not provided", () => {
      const before = Date.now();
      uiStore.pushFileOp({ type: "read", path: "test.ts", preview: "" });
      const after = Date.now();

      const state = uiStore.getState();
      const op = state.fileOps[state.fileOps.length - 1];
      expect(op.timestamp).toBeGreaterThanOrEqual(before);
      expect(op.timestamp).toBeLessThanOrEqual(after);
    });

    it("preserves an explicitly provided timestamp", () => {
      const explicit = 1700000000000;
      uiStore.pushFileOp({ type: "write", path: "out.ts", preview: "", timestamp: explicit });

      const state = uiStore.getState();
      const op = state.fileOps[state.fileOps.length - 1];
      expect(op.timestamp).toBe(explicit);
    });
  });
});
