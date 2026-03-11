import { describe, expect, it } from "vitest";

import { parseReviewResponse } from "../feature_creator.js";

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
