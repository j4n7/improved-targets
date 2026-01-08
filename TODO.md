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
- GM token context menu suppression (optional UX)
  - Prevent token HUD opening on right click when module handles targeting.
  - Show token HUD only on Shift + right click (or other modifier).
  - Constraint: initially support/test only for GM using the Foundry desktop application (Electron). Browser behavior (Firefox/macOS) may differ.

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
