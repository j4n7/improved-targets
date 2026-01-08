# TODO

Priority levels:
- P0: must fix to be usable
- P1: important, next iteration
- P2: nice to have
- P3: later / optional

## P1
- Settings UI (module settings)
  - Expose toggles currently hardcoded:
    - syncCoreTargets
    - showPlayerOwnedPersistent
    - DEBUG
  - Provide defaults and per-world vs per-client decision.

- Redraw triggers completeness
  - Add `targetToken` hook: redraw overlays when native targets are changed by other means (T key, other modules).

- Debug/log hygiene
  - Replace TEST counters with a single `DEBUG` flag.
  - Standardize log prefix and reduce noise.

## P2
- Hover UX enhancements
  - Optional "incoming targets" mode on modifier key.
  - Limit or aggregate incoming lines if noisy.

- Visual polish
  - Fine tune alpha/thickness per state (active vs hover).
  - Optional line style (dashed) for hover.

## P2 / P3
- Isometric Perspective compatibility
  - Detect `isometric-perspective` active.
  - Adjust drawing coordinate space so lines and shapes render correctly in isometric mode.
  - Validate on at least one rotated/skewed scene configuration.

## P3
- Persistence policy options
  - Optional keep targets across combats vs clear on combat end.
  - Optional auto-clear on turn change.

- GM token context menu suppression (optional UX)
  - Make MMB work on token when HUD is open.


# Changelog

All notable changes to this project will be documented in this file.

## [0.0.2] - 2026-01-08

- GM token context menu suppression (optional UX)
  - Prevent token HUD opening on right click when module handles targeting.
  - Show/close token HUD on MMB click.

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
