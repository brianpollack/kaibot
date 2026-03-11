import { describe, expect, it } from "vitest";

import { slugify } from "../slugify.js";

describe("slugify", () => {
  it("converts spaces to underscores and lowercases", () => {
    expect(slugify("This is a new feature")).toBe("this_is_a_new_feature");
  });

  it("replaces multiple non-alphanum chars with a single underscore", () => {
    expect(slugify("Add  OAuth--flow")).toBe("add_oauth_flow");
  });

  it("trims whitespace", () => {
    expect(slugify("  hello world  ")).toBe("hello_world");
  });

  it("strips leading and trailing underscores", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("handles single word", () => {
    expect(slugify("Auth")).toBe("auth");
  });

  it("handles mixed punctuation", () => {
    expect(slugify("Add user's email (optional)")).toBe(
      "add_user_s_email_optional",
    );
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(slugify("   ")).toBe("");
  });

  it("returns empty string for special-chars-only input", () => {
    expect(slugify("---")).toBe("");
  });

  it("preserves numbers", () => {
    expect(slugify("Add OAuth 2.0 support")).toBe("add_oauth_2_0_support");
  });
});
