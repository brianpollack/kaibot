Feature ID: JpKCNm6C

Feature ID: PCms7LtJ

Update the internal web server to add Expires: headers and No-cache header such that all requests immediately expire.  Things like css and javascript files expire immediately.  Further add a robots.txt handler that disallows all robots.

## Plan

- [x] 1. Add no-cache response headers helper to routes.ts that sets Cache-Control, Pragma, and Expires headers on all responses — added NO_CACHE_HEADERS constant in routes.ts
- [x] 2. Add a /robots.txt route handler that returns a Disallow-all robots.txt response — added route before login redirect in routes.ts
- [x] 3. Apply no-cache headers to all existing route responses (HTML, API, static files, 404) — spread NO_CACHE_HEADERS into all writeHead calls including serveStatic
- [x] 4. Add tests for the new robots.txt route and cache headers — created src/__tests__/routes.test.ts
- [x] 5. Run typecheck, lint, and tests to verify everything passes — all pass (typecheck clean, lint warnings only, 219 tests pass)

## Summary

Updated the internal web server (`src/web/routes.ts`) to add comprehensive no-cache headers to all HTTP responses. A `NO_CACHE_HEADERS` constant sets `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, and `Expires: 0` — applied to every route including HTML pages, API endpoints, static files (CSS, JS, images), redirects, and error responses. Added a new `/robots.txt` route that returns a `Disallow: /` response blocking all robots. Created `src/__tests__/routes.test.ts` with 5 tests verifying the robots.txt content and no-cache headers across multiple route types.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.6587
- **Turns:** 23
- **Time:** 187.7s
