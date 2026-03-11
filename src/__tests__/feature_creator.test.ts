import { describe, expect, it } from "vitest";

import { deriveFeatureName, parseReviewResponse } from "../feature_creator.js";

// ---------------------------------------------------------------------------
// parseReviewResponse
// ---------------------------------------------------------------------------

describe("parseReviewResponse", () => {
  it("parses a READY response", () => {
    const response = "READY\nThis feature adds user authentication via OAuth 2.0.";
    const result = parseReviewResponse(response);
    expect(result.type).toBe("ready");
    expect(result).toHaveProperty(
      "content",
      "This feature adds user authentication via OAuth 2.0.",
    );
  });

  it("parses a CLARIFY response", () => {
    const response = "CLARIFY\nWhat OAuth provider should be used?\nShould we support refresh tokens?";
    const result = parseReviewResponse(response);
    expect(result.type).toBe("clarify");
    expect(result).toHaveProperty(
      "questions",
      "What OAuth provider should be used?\nShould we support refresh tokens?",
    );
  });

  it("treats unrecognized format as ready", () => {
    const response = "Here is the feature specification...";
    const result = parseReviewResponse(response);
    expect(result.type).toBe("ready");
    expect(result).toHaveProperty("content", "Here is the feature specification...");
  });

  it("handles READY with extra whitespace", () => {
    const response = "  READY  \n\n  Some content here  ";
    const result = parseReviewResponse(response);
    expect(result.type).toBe("ready");
    expect(result).toHaveProperty("content", "Some content here");
  });

  it("handles CLARIFY with extra whitespace", () => {
    const response = "  CLARIFY  \n\n  A question?  ";
    const result = parseReviewResponse(response);
    expect(result.type).toBe("clarify");
    expect(result).toHaveProperty("questions", "A question?");
  });

  it("handles empty READY response", () => {
    const response = "READY";
    const result = parseReviewResponse(response);
    expect(result.type).toBe("ready");
    expect(result).toHaveProperty("content", "");
  });

  it("handles multiline READY content", () => {
    const content = "Line 1\nLine 2\nLine 3";
    const response = `READY\n${content}`;
    const result = parseReviewResponse(response);
    expect(result.type).toBe("ready");
    expect(result).toHaveProperty("content", content);
  });
});

// ---------------------------------------------------------------------------
// deriveFeatureName
// ---------------------------------------------------------------------------

describe("deriveFeatureName", () => {
  it("extracts meaningful words from a simple description", () => {
    expect(deriveFeatureName("Add user authentication via OAuth")).toBe(
      "Add user authentication via OAuth",
    );
  });

  it("filters out stop words", () => {
    expect(deriveFeatureName("Add a new login page for the app")).toBe(
      "Add new login page app",
    );
  });

  it("limits to 5 meaningful words", () => {
    expect(
      deriveFeatureName(
        "Implement automatic retry logic with exponential backoff and jitter support",
      ),
    ).toBe("Implement automatic retry logic exponential");
  });

  it("uses only the first line of a multi-line description", () => {
    const desc = "Add search functionality\nThis should support fuzzy matching\nAnd pagination";
    expect(deriveFeatureName(desc)).toBe("Add search functionality");
  });

  it("strips punctuation from words", () => {
    expect(deriveFeatureName("Add user's email (optional)")).toBe(
      "Add users email optional",
    );
  });

  it("falls back to all words if only stop words are present", () => {
    // Unlikely, but handles edge case
    expect(deriveFeatureName("the a an")).toBe("the a an");
  });

  it("handles a description with many stop words interspersed", () => {
    expect(deriveFeatureName("Create a way to handle the errors in the system")).toBe(
      "Create way handle errors system",
    );
  });

  it("returns empty string for empty input", () => {
    expect(deriveFeatureName("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(deriveFeatureName("   ")).toBe("");
  });

  it("handles single meaningful word", () => {
    expect(deriveFeatureName("Authentication")).toBe("Authentication");
  });
});
