import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock KaiClient so we don't make real API calls
// ---------------------------------------------------------------------------

const mockRun = vi.fn();

vi.mock("../KaiClient.js", () => ({
  KaiClient: vi.fn().mockImplementation(() => ({
    run: mockRun,
  })),
}));

import { generateTitle } from "../KaiAgent.js";

describe("generateTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a title from the SDK response", async () => {
    mockRun.mockResolvedValue("Add feature title generation");
    const title = await generateTitle("Some feature description content", "/tmp/project");
    expect(title).toBe("Add feature title generation");
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it("returns empty string for empty content", async () => {
    const title = await generateTitle("", "/tmp/project");
    expect(title).toBe("");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns empty string for whitespace-only content", async () => {
    const title = await generateTitle("   \n\n  ", "/tmp/project");
    expect(title).toBe("");
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("truncates titles longer than 80 characters", async () => {
    const longTitle = "A".repeat(100);
    mockRun.mockResolvedValue(longTitle);
    const title = await generateTitle("Some feature", "/tmp/project");
    expect(title).toHaveLength(80);
  });

  it("returns short titles even if under 20 characters", async () => {
    mockRun.mockResolvedValue("Short title");
    const title = await generateTitle("Some feature", "/tmp/project");
    expect(title).toBe("Short title");
  });

  it("returns empty string on SDK error", async () => {
    mockRun.mockRejectedValue(new Error("API error"));
    const title = await generateTitle("Some feature", "/tmp/project");
    expect(title).toBe("");
  });

  it("trims whitespace from the SDK response", async () => {
    mockRun.mockResolvedValue("  Feature title with spaces  \n");
    const title = await generateTitle("Some feature", "/tmp/project");
    expect(title).toBe("Feature title with spaces");
  });
});
