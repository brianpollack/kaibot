import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { invalidateSecretsCache, redactSecrets } from "../web/secretFilter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TMP = "/tmp/kai-secret-filter-test";

function writeEnv(contents: string): void {
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, ".env"), contents, "utf8");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  invalidateSecretsCache();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

afterEach(() => {
  invalidateSecretsCache();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("redactSecrets — no .env file", () => {
  it("returns text unchanged when no .env exists", () => {
    mkdirSync(TMP, { recursive: true });
    const text = "my secret is sk-ant-abc123456789";
    expect(redactSecrets(text, TMP)).toBe(text);
  });

  it("returns text unchanged when projectDir is empty string", () => {
    const text = "some text";
    expect(redactSecrets(text, "")).toBe(text);
  });
});

describe("redactSecrets — basic redaction", () => {
  it("replaces a secret value with ***", () => {
    writeEnv("ANTHROPIC_API_KEY=sk-ant-abc12345\n");
    expect(redactSecrets("key is sk-ant-abc12345 done", TMP))
      .toBe("key is *** done");
  });

  it("replaces all occurrences in the text", () => {
    writeEnv("API_KEY=supersecret12345\n");
    const result = redactSecrets("a=supersecret12345 b=supersecret12345", TMP);
    expect(result).toBe("a=*** b=***");
  });

  it("redacts secret embedded inside a JSON string", () => {
    writeEnv("OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxx\n");
    const json = JSON.stringify({ statusMessage: "token sk-or-v1-xxxxxxxxxx used" });
    expect(redactSecrets(json, TMP)).toContain("***");
    expect(redactSecrets(json, TMP)).not.toContain("sk-or-v1-xxxxxxxxxx");
  });

  it("handles secrets with quotes stripped", () => {
    writeEnv('SECRET_TOKEN="my-token-abcdef99"\n');
    expect(redactSecrets("bearer my-token-abcdef99", TMP)).toBe("bearer ***");
  });

  it("handles single-quoted values", () => {
    writeEnv("DB_PASS='hunter2abcde'\n");
    expect(redactSecrets("pass=hunter2abcde", TMP)).toBe("pass=***");
  });
});

describe("redactSecrets — skip safe/short values", () => {
  it("does not redact values shorter than 8 characters", () => {
    writeEnv("PORT=8080\n");
    const text = "port is 8080";
    expect(redactSecrets(text, TMP)).toBe(text);
  });

  it("does not redact 'true' or 'false'", () => {
    writeEnv("DEBUG=true\nVERBOSE=false\n");
    expect(redactSecrets("debug is true and verbose is false", TMP))
      .toBe("debug is true and verbose is false");
  });

  it("does not redact 'localhost'", () => {
    writeEnv("DB_HOST=localhost\n");
    expect(redactSecrets("connecting to localhost:5432", TMP))
      .toBe("connecting to localhost:5432");
  });

  it("does not redact 'development' or 'production'", () => {
    writeEnv("NODE_ENV=development\n");
    expect(redactSecrets("env is development", TMP)).toBe("env is development");
  });

  it("skips blank lines and comments in .env", () => {
    writeEnv("# This is a comment\n\nAPI_KEY=realtoken9999\n");
    expect(redactSecrets("using realtoken9999", TMP)).toBe("using ***");
  });
});

describe("redactSecrets — ordering and cache", () => {
  it("redacts the longer secret when two secrets share a prefix", () => {
    writeEnv("SHORT_KEY=abcdefgh\nLONG_KEY=abcdefghijklmn\n");
    // The longer key includes the shorter; longer should be replaced first
    const result = redactSecrets("token=abcdefghijklmn", TMP);
    expect(result).toBe("token=***");
    expect(result).not.toContain("abcdefgh");
  });

  it("caches secrets for the same projectDir", () => {
    writeEnv("API_KEY=cached-secret-xyz\n");
    // First call loads from disk
    expect(redactSecrets("cached-secret-xyz", TMP)).toBe("***");
    // Overwrite the file — cache should still use old value
    writeFileSync(join(TMP, ".env"), "API_KEY=different-secret-abc\n", "utf8");
    expect(redactSecrets("cached-secret-xyz", TMP)).toBe("***");
  });

  it("reloads after invalidateSecretsCache()", () => {
    writeEnv("API_KEY=first-secret-1234\n");
    expect(redactSecrets("first-secret-1234", TMP)).toBe("***");

    invalidateSecretsCache();
    writeEnv("API_KEY=second-secret-5678\n");

    expect(redactSecrets("first-secret-1234", TMP)).toBe("first-secret-1234");
    expect(redactSecrets("second-secret-5678", TMP)).toBe("***");
  });
});

describe("redactSecrets — multiple secrets", () => {
  it("redacts multiple different secrets in one pass", () => {
    writeEnv("ANTHROPIC_API_KEY=sk-ant-123456\nOPENROUTER_KEY=sk-or-9876543\n");
    const text = "keys: sk-ant-123456 and sk-or-9876543";
    expect(redactSecrets(text, TMP)).toBe("keys: *** and ***");
  });
});
