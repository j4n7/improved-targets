# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1] - 2026-01-08

### Added
- Combat-only overlay system for token targeting:
  - Persistent connections for the active combatant visible to all users.
  - Hover-based redraw support.
- Right-click targeting workflow:
  - Right click to set a single target.
  - Ctrl/Cmd + right click to toggle multi-target.
  - Left click on empty canvas clears targets.
- Token outlines:
  - Inside-cell outline + semi-transparent fill in player color.
- Anti-metagaming visibility gate:
  - Do not apply core targets to tokens not visible to the local user.
- Core Foundry targeting sync:
  - Module targets also set Foundry native targets (equivalent to user targeting).
  - Clearing also clears native targets.
- Network propagation:
  - Socket-based redraw broadcast.
  - GM-authoritative writes for combatant target flags (player -> GM consistency).
- Cleanup and integrity:
  - Combat end cleanup clears overlays and native targets.
  - GM sanitizer removes invalid token IDs from combatant target flags when tokens are deleted or scenes load.
- Movement handling:
  - Overlay redraw on `refreshToken` (fixes lines not updating after token movement).

### Fixed
- Right click processed twice (pointerdown + rightdown), which broke toggle behavior.
- Outline positioning issues caused by using render bounds instead of document coordinates.
- Remote clear not propagating from players to GM (permission / authority issue).
