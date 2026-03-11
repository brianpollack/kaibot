// ---------------------------------------------------------------------------
// Slug generation for feature file names
// ---------------------------------------------------------------------------

/**
 * Converts a human-readable feature name into a file-system-safe slug.
 *
 * Examples:
 *   "This is a new feature"  → "this_is_a_new_feature"
 *   "Add  OAuth--flow"       → "add_oauth_flow"
 *   "  hello world  "        → "hello_world"
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // replace non-alphanum runs with underscore
    .replace(/^_|_$/g, "");       // strip leading/trailing underscores
}
