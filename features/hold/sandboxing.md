Title: Sandbox Network Permission Popup

When the agent attempts to run a Bash command that initiates an outbound network
connection to a host not already on the approved list, pause execution and surface
a popup to the browser asking the user to Allow Once, Allow Always for this Folder,
or Decline — before the command enters the sandbox.

## Background

The Claude Agent SDK sandbox blocks TCP connections at the OS/kernel level. There
is no SDK hook that fires when a syscall is denied — the only viable intercept
point is the existing PreToolUse hook (bashSecurityHook) which sees the full Bash
command string before it runs.

The existing clarify-request / clarify-response WebSocket round-trip (used by the
clarify modal) provides a proven pattern for pausing the agent and awaiting a user
decision from the browser.

## Plan

- [ ] **Phase 1 — Command-pattern detection (`security.ts`)**
  - Extend `bashSecurityHook` to recognise commands that will likely initiate
    outbound TCP connections and are not already in `SANDBOX_NETWORK_COMMANDS`.
  - Detection heuristics:
    - Known network clients not on the allowlist: `psql`, `mysql`, `mongo`,
      `redis-cli`, `nc`, `ssh`, `ftp`, `sftp`, `telnet`
    - Arguments containing URLs or hostnames: `curl http://...`,
      `psql postgres://...`, flags like `--host`, `-H host`, `--url`
  - Commands already in `SANDBOX_NETWORK_COMMANDS` (npm, pip, mix, etc.) pass
    through silently — no popup.

- [ ] **Phase 2 — Async permission request (`KaiClient.ts` / `wsHandler.ts`)**
  - Add `requestNetworkPermission(command: string): Promise<"allow-once" | "allow-always" | "decline">` that:
    1. Broadcasts `{ type: "network-permission-request", command }` over WebSocket
       to all connected browser clients.
    2. Registers a one-shot listener for `{ type: "network-permission-response", decision }`.
    3. Resolves with the user's decision, or resolves to `"decline"` after a 30s
       timeout.
  - Wire `requestNetworkPermission` into `bashSecurityHook`: when a network command
    is detected, call it and return `{ decision: "block" }` on decline, or proceed
    on allow.

- [ ] **Phase 3 — Browser popup (`client.js`)**
  - On `network-permission-request`, show a modal with:
    - The command string that triggered the request.
    - Three buttons: **Allow Once**, **Allow Always for this Folder**, **Decline**.
    - A countdown timer (30s) that auto-dismisses with Decline.
  - Send `{ type: "network-permission-response", decision }` back over the signed
    WebSocket on any button press or timeout.

- [ ] **Phase 4 — Persistent per-project allowlist**
  - On "Allow Always for this Folder", extract the base command (and optionally the
    target host) and append it to `.kaibot/network-allow.json` in the project dir.
  - `KaiClient.init()` reads `.kaibot/network-allow.json` at startup and merges its
    entries into `SANDBOX_NETWORK_COMMANDS` so decisions survive across restarts.

## Limitations

- Intercept granularity is the whole Bash command, not an individual `connect()`
  syscall. The destination IP:port is only known if it appears in the command args.
- Library-level TCP connections made by agent-written scripts (`node script.js`,
  `python script.py`) bypass Bash entirely and cannot be intercepted this way.
  Those are controlled only by the static `network` settings in
  `buildSecuritySettings()`.
