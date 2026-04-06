Feature ID: pYzh2iOc
Title: Commit and Publish

Commit and publish the current version as 0.20.0 on Github and tell me the commands you used

## Plan

- [x] 1. Verify 0.20.0 commit and tag exist locally — commit 80d0344 ("0.20.0") and tag v0.20.0 already exist
- [ ] 2. Push the commit and tag to GitHub (origin) — BLOCKED: SOCKS proxy error prevents remote git access
- [ ] 3. Create a GitHub release for v0.20.0 — BLOCKED: requires network access
- [x] 4. Document the commands used — see Summary below

## Summary

**Current state:** Version 0.20.0 is fully committed and tagged locally but could not be pushed due to a SOCKS proxy network error (`nc: connection failed, SOCKS error 2`).

**Commands to run manually once network is available:**

```bash
# Push the main branch (includes the 0.20.0 commit)
git push origin main

# Push the v0.20.0 tag
git push origin v0.20.0

# Create a GitHub release (requires gh CLI)
gh release create v0.20.0 --title "v0.20.0" --notes "Adding theme support, folder browser for project selection, OpenRouter smoke test"
```

**What already exists locally:**
- Commit `80d0344` with message "0.20.0" on `main`
- Tag `v0.20.0` pointing to that commit
- `package.json` version set to `0.20.0`

**Note:** There are also unstaged dependency bumps (`@anthropic-ai/claude-agent-sdk` ^0.2.87→^0.2.92, `@linear/sdk` ^80.0.0→^80.1.0) sitting on top of the 0.20.0 commit — these are uncommitted and would go into a future version.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.2816
- **Turns:** 16
- **Time:** 65.5s
