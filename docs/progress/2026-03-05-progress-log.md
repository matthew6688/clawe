# Progress Log — 2026-03-05 (Australia/Brisbane)

## Goal

Stabilize local Clawe demo, fix onboarding/login/runtime failures, and implement reliable multi-agent collaboration routing with controllable delegation behavior.

## Completed

- Resolved local runtime startup issues and made Docker startup path consistent (`clawe`, `squadhub`, `watcher`).
- Fixed mention-based routing and switched to sync dispatch for deterministic responses.
- Added specialist-first response mode with lead synthesis appended by Clawe.
- Added and wired runtime flags for routing/synthesis behavior:
  - `CLAWE_MENTION_DISPATCH_MODE`
  - `CLAWE_APPEND_LEAD_SYNTHESIS`
  - `CLAWE_LEAD_SYNTHESIS_TIMEOUT_SECONDS`
  - `CLAWE_MARK_SYNC_NOTIFICATIONS_DELIVERED`
- Added Kimi compatibility in chat/provider fallback path and key handling flow.
- Implemented no-mention delegation guard:
  - Default no-mention messages stay with Clawe.
  - Auto-collab requires explicit confirmation signal.
  - Added `CLAWE_REQUIRE_DELEGATION_CONFIRMATION=true`.
- Added backend hard guard for main session no-mention turns:
  - injects clarification-only policy prompt
  - blocks task/delegation intent until explicit user confirmation.
- Updated Clawe squad-lead prompt template to enforce:
  - clarify first
  - delegate only after explicit go-ahead.
- Increased default session send timeout to reduce false “queue busy” responses:
  - `CLAWE_SESSION_SEND_TIMEOUT_SECONDS=120`.
- Reset main agent session cache and restarted services to apply new behavior immediately.

## Validation

- `pnpm --filter @clawe/web test src/app/api/chat/route.spec.ts` passed (`16/16`).
- `pnpm --filter @clawe/web check-types` passed.
- Docker status healthy after rebuild/restart:
  - `clawe` up
  - `squadhub` healthy
  - `watcher` up

## Branch & Commits

Working branch: `codex/backup-20260304-2346`

- `60cf1b6` fix(chat): enforce clarification mode before Clawe delegation
- `398a5f4` feat(chat): require delegation confirmation before auto-collab
- `c4d2b7e` feat(chat): append Clawe lead synthesis after specialist replies
- `8ecf900` backup: persist current clawe local fixes before routing changes

Remote pushed: `matthew/codex/backup-20260304-2346`
