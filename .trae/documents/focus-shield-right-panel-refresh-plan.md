# /plan Focus Shield + Right Panel Refresh Plan

## Summary

Implement a balanced `/plan` workspace refinement centered on two outcomes:
1. Make Focus Shield reliable and fully integrated with the `/plan` workflow by auto-activating when a `/plan`-created plan is started, while preserving manual activation from the header button, `Alt+S`, assistant actions, and external shield-state changes.
2. Reduce desktop right-column clutter in the Focus workspace by keeping only live execution summaries there, then moving duplicated or maintenance-heavy controls to more natural locations without breaking accessibility or responsive behavior.

## Current State Analysis

- The Focus workspace desktop layout is driven by `.focus-primary-grid` and `.focus-grid-secondary` in `styles.css`. The secondary cards act as the effective right-side panel.
- `renderer.js` currently implements Focus Shield as a simple `display` toggle plus a POST to `http://localhost:3456/api/shield-state`. It does not:
  - sync overlay content with the live timer,
  - react to external `shield-state-changed` messages already emitted by `test-server.js`,
  - provide a smooth exit transition,
  - manage focus, background inertness, or keyboard containment for accessibility.
- `preload.js` exposes timer and plan IPC hooks, but it does not expose a `shield-state-changed` listener to the renderer.
- The `/plan` flow in `renderer.js` already auto-starts the focus timer from `handlePlanCommand()` and from `setupCurrentPlanButtons()`, but neither path activates Focus Shield.
- The right column is cluttered by mixed-priority controls:
  - `#focus-session-panel` combines live session status with session configuration inputs and a focus report.
  - `#currentPlanSection` includes both high-priority execution UI and lower-priority maintenance actions.
  - The full Focus Timer section below duplicates timer execution/configuration responsibilities.
- `renderer.js` contains two `renderCurrentPlan()` definitions. The later one wins at runtime, but the duplication makes the file harder to reason about and increases the chance of regressions during UI redistribution.
- Existing regression coverage for layout is mostly static string assertions in `__tests__/workspace-ui-regression.test.js`; there is no focused regression coverage for shield wiring.

## Proposed Changes

### 1. `index.html`

- Convert the Focus Shield overlay markup into an always-mounted, semantic overlay shell that supports animated open/close states instead of inline `display: none`.
- Add the missing accessibility hooks for the overlay:
  - `role="dialog"`,
  - `aria-modal="true"`,
  - state attributes/classes for active/exiting transitions.
- Keep `#main-app` as the background app root used for inert/interaction disabling while the shield is active.
- Simplify the right-column cards:
  - `#focus-session-panel` becomes a compact live session summary card with status, live countdown, and start/pause/resume/stop actions only.
  - `#currentPlanSection` keeps current plan progress, task list, and the single primary CTA for starting the plan.
- Redistribute removed but still-important controls:
  - move session configuration inputs (`#session-work-minutes`, `#session-break-minutes`, `#session-strict`) into the main `#focus-timer-section`, since they affect how focus timing behaves,
  - move the `#focus-report` block out of the right column and into `#moreInsightsPanel` beside existing insights/statistics content,
  - move plan maintenance actions (`Edit`, `Export`, `Save as Template`, `Clear`) out of the right column and into the plan creation/management area under `#focus-plan-builder` in a compact “Manage Current Plan” disclosure.

### 2. `renderer.js`

- Replace the current ad-hoc shield toggle with a single stateful Focus Shield controller that:
  - tracks active/exiting states,
  - stores/restores the previously focused element,
  - toggles `inert`/`aria-hidden` on `#main-app` and `#bot-drawer`,
  - traps keyboard focus inside the shield while active,
  - closes on explicit exit only, not accidental background interaction.
- Populate shield UI from live app state:
  - task title from `currentPlan`,
  - goal from `currentPlan.goal`,
  - timer text from the same timer polling used by `updateTimerDisplay()`,
  - mode badge from the active timer mode,
  - sound label from the selected soundscape/music state when available.
- Add auto-activation triggers only for plan-start flows:
  - when `/plan` creates and starts a plan in `handlePlanCommand()`,
  - when `Start Plan` is clicked from `setupCurrentPlanButtons()`.
- Keep manual activation paths working:
  - header button,
  - `Alt+S`,
  - assistant `toggle_focus_shield` action handling.
- Add shield synchronization for external workflows:
  - consume `onShieldStateChanged` from `preload.js`,
  - update the renderer overlay when the extension or server toggles shield state.
- Refactor the right-column behavior to match the new information architecture:
  - remove the focus report from `#focus-session-panel`,
  - move session configuration rendering/behavior into `#focus-timer-section`,
  - render current-plan maintenance actions in the plan-builder management disclosure instead of the sidebar card.
- Remove the earlier duplicate `renderCurrentPlan()` implementation and keep one final renderer path only.

### 3. `preload.js`

- Expose a new `onShieldStateChanged(callback)` bridge for the existing `shield-state-changed` event already sent from `test-server.js`.
- Keep the API shape consistent with the other event subscriptions in this file.

### 4. `styles.css`

- Rework the Focus Shield overlay styles to use class/state-based transitions instead of inline display toggling:
  - hidden state with `opacity`, `visibility`, and `pointer-events`,
  - active state with enter animation,
  - exit state with a short reverse transition.
- Add styles for background interaction blocking and any inert/focus-lock affordances needed by the overlay.
- Tighten the desktop Focus workspace hierarchy:
  - make right-column cards visibly calmer and more summary-oriented,
  - ensure redistributed controls look native in their new locations,
  - preserve existing responsive breakpoints so the layout stacks cleanly below `1100px`, `768px`, and `480px`.
- Add styles for the new “Manage Current Plan” disclosure and for the relocated focus report inside the Insights area.

### 5. `__tests__/workspace-ui-regression.test.js`

- Extend the existing static workspace regression coverage to assert that:
  - the Focus tab keeps its balanced primary/secondary layout hooks,
  - the right-column cards no longer include the relocated low-priority content,
  - the More/Insights area now contains the relocated focus report surface,
  - the plan-management disclosure exists in the plan builder area.

### 6. `__tests__/focus-shield-ui-regression.test.js` (new)

- Add a lightweight Node-based regression test that reads `index.html`, `renderer.js`, `preload.js`, and `styles.css` as text and asserts the new shield wiring exists:
  - preload exposes `onShieldStateChanged`,
  - renderer listens for shield-state updates,
  - renderer auto-activates shield on plan-start paths,
  - renderer updates overlay state via classes/attributes rather than inline `display`,
  - overlay markup includes dialog/accessibility hooks.

## Assumptions & Decisions

- Confirmed decision: Focus Shield auto-activates on plan start, not on every generic timer start.
- Confirmed decision: the Focus workspace cleanup should be balanced, not conservative or aggressive.
- The “right-side panel” is interpreted as the desktop Focus workspace secondary column implemented through `.focus-grid-secondary`.
- External shield synchronization will reuse the existing `test-server.js` event emission instead of introducing a new backend contract.
- The implementation will not change the Chrome extension popup workflow itself unless a regression fix is required for shield-state parity.
- The implementation will preserve the current design language and existing responsive breakpoints instead of introducing a new layout system.

## Verification Steps

1. Automated checks
   - Run `npm test -- __tests__/workspace-ui-regression.test.js __tests__/focus-shield-ui-regression.test.js __tests__/plan-command.test.js __tests__/focus-plan-manager.test.js`
   - Run `npm test -- __tests__/commands.test.js` if any `/plan` command wiring changes affect shared command flows.

2. Manual desktop workflow checks
   - Start a plan from `/plan work 60` in the Focus tab and confirm:
     - timer starts,
     - shield opens automatically,
     - overlay title/goal/timer/mode are populated,
     - background UI is not clickable,
     - focus stays inside the shield,
     - exit uses a smooth transition and restores focus.
   - Start a plan from `Start Plan` in `#currentPlanSection` and confirm the same behavior.
   - Toggle shield manually from the header button and with `Alt+S` and confirm state parity.
   - Toggle shield from the extension/server path and confirm renderer sync via `shield-state-changed`.

3. Layout and discoverability checks
   - Confirm the right column now reads as a live execution rail, not a mixed settings/report panel.
   - Confirm session settings are easy to find in the timer area.
   - Confirm focus report is discoverable in Insights.
   - Confirm current-plan maintenance actions are easy to find in the plan-builder management disclosure.

4. Responsive/accessibility checks
   - Verify desktop, tablet, and mobile widths still stack correctly.
   - Verify keyboard-only use for opening, navigating, and closing the shield.
   - Verify no hidden-but-focusable elements remain accessible behind the active shield.
