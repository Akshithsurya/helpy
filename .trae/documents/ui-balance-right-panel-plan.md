# UI Balance Plan

## Summary
- Redesign the current desktop workspace without changing the existing tab model: keep `Focus`, `Tasks`, `Notifications`, and `More` as the primary navigation.
- Remove visual clutter by reducing dense stacking in the support-heavy areas, especially the overloaded `More` tab content and the top workspace region that currently lacks dedicated grid styling.
- Evenly redistribute visual weight with explicit layout grids, calmer utility-card styling, and grouped supporting content while preserving all current controls, data surfaces, disclosure behavior, and keyboard/focus accessibility.
- Include a quick usability validation for standard desktop and tablet-sized viewports after implementation.

## Current State Analysis
- `index.html` already contains structural hooks for a more balanced layout, including `div.focus-primary-grid`, `div.more-actions-grid`, and repeated `.nested-section` cards inside `#moreInsightsPanel`, but those classes do not currently have matching layout rules in `styles.css`.
- The `Focus` tab has a strong set of primary sections near the top (`Focus Workspace`, `Active Session`, `Current Plan`), but the lack of dedicated grid styling means the top region is not intentionally balanced.
- The `More` tab concentrates six separate support panels (`Focus Statistics`, `Weekly Focus Chart`, `Clipped Web Notes & Highlights`, `Browser Bridge`, `System Monitor`, `Activity Tracking`) into one long disclosure stack, which creates the strongest visual-density problem in the current UI.
- `renderer.js` keeps the `More` navigation wiring intact through `revealMorePanel(...)`, but the chart resize listener still checks for `stats-tab`, which is not present in `index.html`; that would prevent reliable chart resizing during viewport-based usability checks.
- Existing regression coverage in `__tests__/workspace-ui-regression.test.js` already protects the More-tab entry points and should be extended instead of replaced.

## Proposed Changes

### 1. Rework the layout structure in `index.html`
- Keep all existing tabs and major features in their current product areas.
- Add explicit grouping wrappers inside the existing tabs so supporting content can be distributed evenly without removing functionality:
  - Keep the existing `focus-primary-grid` container and ensure the three top focus cards remain the main balanced workspace row/stack.
  - Inside `#moreInsightsPanel`, wrap the existing `.nested-section` cards in a dedicated insights grid container so statistics/chart, notes/bridge, and system/activity content can be spread across columns instead of appearing as one vertical wall.
  - Keep both `details.section-disclosure` containers (`#moreInsightsPanel`, `#moreProfilePanel`) and their summaries so disclosure semantics remain intact.
- Preserve all existing IDs used by `renderer.js` (`statisticsData`, `focusChart`, `desktopWebNotesList`, `bridgeStatusCard`, `bridgeTabsData`, `systemMonitorData`, `activityHistory`, `appUsageStats`, auth container IDs, and More quick-action button IDs).

### 2. Add the missing balancing layout rules in `styles.css`
- Define concrete layout rules for the currently unstyled hooks already present in the markup:
  - `.focus-primary-grid`
  - `.more-actions-grid`
  - `.nested-section`
- Add new supporting layout classes introduced in `index.html` for the More insights redistribution (for example, a dedicated insights grid wrapper and optional subgroup wrappers for paired cards).
- Use responsive CSS Grid for desktop and tablet behavior:
  - Desktop: balance the top Focus cards into a multi-column arrangement with consistent gaps and aligned heights where practical.
  - Desktop: distribute the More insights cards across two columns so no single side feels heavier than the other.
  - Tablet: collapse to a single-column or wider two-up layout where needed so cards remain readable and avoid cramped right-edge stacking.
- Reduce clutter in dense support areas by toning down decorative treatment selectively in utility-heavy cards:
  - smaller card padding variance,
  - flatter rotations in dense nested sections,
  - calmer shadow/border treatment for stacked support panels,
  - more consistent heading spacing,
  - scroll containers with predictable height ceilings where long content already exists.
- Preserve accessibility styling:
  - keep visible focus states,
  - avoid hiding disclosure summaries,
  - maintain readable contrast in light/dark/space themes,
  - avoid layout changes that break button hit areas or canvas visibility.

### 3. Make the layout-aware behavior update in `renderer.js`
- Update the resize logic for the weekly focus chart so it responds when the actual `More` tab is active instead of checking the stale `stats-tab` ID.
- Keep all existing More quick-action behavior unchanged:
  - `openInsightsFromMoreBtn` still reveals `#moreInsightsPanel`
  - `openProfileFromMoreBtn` and `openProfileSettingsBtn` still reveal `#moreProfilePanel`
  - the assistant drawer still opens from `openBotFromMoreBtn`
- If the new markup introduces wrapper containers only, avoid changing data-rendering selectors so content population functions continue targeting their current IDs.

### 4. Extend regression coverage in `__tests__/workspace-ui-regression.test.js`
- Keep the existing navigation-wiring assertions.
- Add assertions for the new layout wrappers/classes that are required for the redistributed design so the structural rebalance does not regress silently.
- Add a regression assertion for the updated chart resize target logic so the responsive usability behavior is covered at the source level.

## Assumptions & Decisions
- Decision confirmed: keep the existing tab structure intact rather than moving major features between tabs.
- “Remove clutter” is interpreted as reducing dense stacking, excessive decorative weight in utility-heavy panels, and uneven distribution of support content, not deleting core functionality.
- “Preserve all critical UI elements” means every existing feature surface in the current `Focus` and `More` markup remains available after the redesign, including disclosures, buttons, chart, history, bridge/system/activity data, and profile/auth sections.
- The implementation should stay within the current `index.html` + `styles.css` + `renderer.js` architecture and avoid introducing a framework migration or separate styling system.

## Verification Steps
1. Run targeted regression coverage for the workspace UI, including the updated More-tab and layout assertions.
2. Run at least one broader sanity check (`npm test` or the smallest practical related Jest scope available in this repo) to confirm the layout refactor does not break existing UI wiring tests.
3. Launch the Electron app and perform a quick manual usability pass in standard viewport sizes:
   - Desktop: around `1280x800` or `1440x900`
   - Tablet: around `1024x768` and/or `768x1024`
4. In that manual pass, verify:
   - the top Focus workspace feels visually balanced,
   - the More insights area no longer reads as a single cluttered right-heavy stack,
   - all buttons/disclosures remain reachable by mouse and keyboard,
   - the weekly chart redraws correctly after viewport resizing,
   - long-content sections still scroll cleanly without overlap or clipped controls.
