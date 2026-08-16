# /plan Enhancements Execution Plan

## Summary

Implement a focused `/plan` upgrade in the existing TypeScript/JavaScript + Ruby stack, centered on:

1. deadline-aware plan recommendations tied to the app's task/deadline data,
2. adaptive focus tuning based on plan history and user energy/intensity inputs,
3. measurable performance improvements across the desktop slash-command flow and Ruby planning API,
4. Ruby and TypeScript/JavaScript refactors that improve maintainability and testability,
5. repeatable before/after benchmarks, automated tests, and a final code-review pass on all changed Ruby and TypeScript/JavaScript files.

Per user direction, the "Dart" portion of the request will be fulfilled in the existing TypeScript frontend/client layer because this repo does not contain Dart or Flutter sources.

## Current State Analysis

- `/plan` already exists in multiple layers:
  - Shared core logic: `chrome-extension/shared/plan-command.ts`
  - Extension/omnibox command handler: `chrome-extension/commands.js`
  - Desktop renderer slash-command flow: `renderer.js`
  - Desktop plan persistence and history: `focus-plan-manager.ts`
  - Desktop IPC bridge: `main.js`, `preload.js`
  - Ruby planning API: `ruby-api/plan_service.rb`, `ruby-api/app.rb`

- Existing `/plan` capabilities already include:
  - preset parsing, duration/chunk/break parsing, tags, templates, export, history, comparison, and smart suggestions,
  - React plan UI in `src/components/PlanBuilder.tsx`, `src/components/PlanPreview.tsx`, and `src/components/PlanShortcuts.tsx`,
  - benchmark-style Jest coverage in `__tests__/benchmark.test.js`.

- The desktop app already exposes task and plan history data via IPC:
  - `preload.js` exposes `getTasks`, `getPlanHistory`, `createPlanFromCommand`, `parsePlanArguments`, etc.
  - `main.js` wires those calls to `TaskManager` and `FocusPlanManager`.

- Task/deadline data already exists in `tasks.js` with fields such as `priority`, `deadline`, `completed`, `archived`, and `tags`.

- Gaps relative to the request:
  - no deadline-aware `/plan` recommendation flow is wired to task data,
  - adaptive tuning is present only as basic recommendation helpers and is not consistently fed by persisted plan history,
  - the desktop renderer still uses a local preset-only autocomplete path in `renderer.js`, so it is not sharing the richer recommendation engine,
  - Ruby exposes parsing/creation/analyze/export APIs, but it does not yet provide a dedicated deadline-aware/adaptive recommendation contract,
  - Ruby test infrastructure is absent from `ruby-api/Gemfile`,
  - `performance-tests/` is currently unused, so there is no stable before/after benchmark harness outside ad hoc Jest timing tests.

## Proposed Changes

### 1. Shared `/plan` intelligence and hot-path refactor

**Files**
- `chrome-extension/shared/plan-command.ts`
- `src/types/index.ts`

**What / Why / How**
- Refactor the shared planner into smaller pure helpers for:
  - deadline scoring,
  - adaptive chunk/break/duration tuning,
  - autocomplete suggestion assembly,
  - benchmark metric collection.
- Add a context-aware recommendation layer that accepts:
  - open tasks with deadlines/priorities,
  - recent plan history and completion metrics,
  - current user energy/work-intensity inputs.
- Extend the shared types with explicit recommendation payloads, for example:
  - `PlanRecommendationContext`
  - `DeadlineAwareSuggestion`
  - `AdaptivePlanTuning`
  - `PlanBenchmarkSnapshot`
- Keep `plan-command.ts` as the source of truth for recommendation logic used by both the desktop app and extension path.
- Improve hot-path performance by:
  - avoiding repeated preset loads/parses,
  - memoizing context-normalization work,
  - collapsing duplicate string normalization,
  - keeping history-derived adaptive metrics in compact structures.

### 2. Desktop data plumbing for deadline-aware recommendations

**Files**
- `focus-plan-manager.ts`
- `main.js`
- `preload.js`

**What / Why / How**
- Extend `FocusPlanManager` to expose a compact focus profile derived from plan history:
  - completion rate,
  - average successful chunk size,
  - average successful break size,
  - preferred session duration,
  - recent productivity trend.
- Add new IPC methods for the desktop UI:
  - `get-plan-recommendations(context?)`
  - `get-plan-benchmark-summary()`
- Keep the renderer-side feature thin by building the recommendation payload in main/shared code and returning a stable contract through `preload.js`.
- Reuse existing `getTasks` and `getPlanHistory` plumbing rather than adding a second task/history store.

### 3. Desktop slash-command UX upgrades

**Files**
- `renderer.js`
- `src/components/PlanBuilder.tsx`
- `src/components/PlanPreview.tsx`
- `src/components/PlanShortcuts.tsx`

**What / Why / How**
- Replace the renderer's preset-only live autocomplete/preview logic with the shared recommendation output so the desktop slash command can:
  - surface urgent deadline-backed suggestions,
  - show adaptive chunk/break recommendations,
  - explain why a suggestion is recommended,
  - preview urgency tags such as "due soon", "high priority", or "fits available focus window".
- Update the React `PlanBuilder` flow to consume the same recommendation payload and provide one-click application of adaptive settings.
- Extend `PlanPreview` to show recommendation metadata without changing the existing layout model:
  - recommended session length,
  - tuned chunk/break values,
  - deadline urgency context,
  - confidence/reason text.
- Keep shortcuts/templates compatible, but allow the UI to highlight when a saved shortcut is no longer optimal compared with the user's recent focus profile.

### 4. Extension/omnibox `/plan` parity improvements

**Files**
- `chrome-extension/commands.js`

**What / Why / How**
- Upgrade `/plan suggest` to use the new shared recommendation payload instead of the current coarse static summary.
- Improve command suggestions so deadline-aware and adaptive recommendations are included where local context is available.
- Preserve current command names and help text shape for compatibility.
- Centralize command timing capture around recommendation generation and plan creation so the extension path contributes to the same performance summary model.

### 5. Ruby planning API enhancements

**Files**
- `ruby-api/plan_service.rb`
- `ruby-api/app.rb`

**What / Why / How**
- Refactor `PlanService` into smaller service-style helpers while preserving public behavior for existing parse/create/export/template flows.
- Extend `analyze_and_suggest(context)` and add a dedicated recommendation endpoint contract:
  - `POST /api/plan/recommend`
- Recommendation inputs will support:
  - tasks with `deadline`, `priority`, `tags`, and completion state,
  - recent plan history summary,
  - optional current energy/intensity hints.
- Recommendation output will include:
  - recommended title/goal source,
  - recommended duration/chunk/break,
  - urgency reasons,
  - confidence and expected productivity gain,
  - fallback behavior when no task/history context exists.
- Keep input validation and response envelope conventions aligned with the existing Sinatra API.

### 6. Benchmark harnesses and measurable targets

**Files**
- `performance-tests/plan-command-benchmark.js`
- `performance-tests/ruby-plan-benchmark.rb`
- `__tests__/benchmark.test.js`

**What / Why / How**
- Create stable benchmark scripts outside the unit suite so we can record a true before/after baseline.
- Baseline run happens first against the current behavior; the same corpus is rerun after implementation.
- JavaScript benchmark corpus will cover:
  - autocomplete suggestion generation,
  - parse/config creation,
  - deadline-aware recommendation generation,
  - desktop slash-command end-to-end preview/build flow.
- Ruby benchmark corpus will cover:
  - `parse_plan`,
  - `create_plan`,
  - `analyze_and_suggest`,
  - `recommend_plan`/`/api/plan/recommend`.
- Benchmark outputs should be written as machine-readable snapshots plus a short markdown summary under:
  - `performance-tests/results/plan-command-baseline.json`
  - `performance-tests/results/plan-command-after.json`
  - `performance-tests/results/ruby-plan-baseline.json`
  - `performance-tests/results/ruby-plan-after.json`
  - `performance-tests/results/summary.md`

**Target improvements**
- Shared TypeScript hot paths (`getAutocompleteSuggestions`, recommendation build, config creation): at least 20% average speedup on the fixed benchmark corpus.
- Ruby recommendation/analyze path: at least 15% average speedup on the fixed benchmark corpus.
- Desktop slash-command live preview/recommendation path: no blocking step above 50ms average on the benchmark fixture set.

### 7. Automated tests

**Files**
- `__tests__/plan-command.test.js`
- `__tests__/focus-plan-manager.test.js`
- `__tests__/background.test.js` or a new `__tests__/command-handler.test.js` if cleaner
- `ruby-api/Gemfile`
- `ruby-api/test/test_helper.rb`
- `ruby-api/test/plan_service_test.rb`
- `ruby-api/test/plan_api_test.rb`

**What / Why / How**
- Extend JavaScript tests to cover:
  - deadline-aware recommendation ranking,
  - adaptive tuning derived from history,
  - autocomplete ordering and fallback cases,
  - IPC/command-handler integration for `/plan suggest` and standard `/plan ...` flows,
  - benchmark helper correctness where deterministic.
- Add Ruby tests using lightweight, repo-appropriate tooling:
  - `minitest`
  - `rack-test`
- Ruby unit tests will cover `PlanService` parsing, recommendation logic, fallback behavior, and validation.
- Ruby API tests will cover `POST /api/plan/analyze` and `POST /api/plan/recommend` response contracts and error handling.

### 8. Final code-review pass on changed Ruby and TypeScript/JavaScript

**Files in review scope**
- All changed files under:
  - `ruby-api/`
  - `chrome-extension/shared/`
  - `chrome-extension/`
  - `src/components/`
  - `focus-plan-manager.ts`
  - `main.js`
  - `preload.js`
  - `renderer.js`

**What / Why / How**
- After implementation and tests, perform a focused review for:
  - Ruby conventions and API error-handling consistency,
  - TypeScript/JavaScript naming, pure-function boundaries, and compatibility risks,
  - duplicated logic introduced during the feature work,
  - dead code or generated-code drift.
- Because the repo has no Dart sources, this review will apply to TypeScript/JavaScript as the accepted substitute for the requested client-side language review.

## Assumptions & Decisions

- Use the existing TypeScript/JavaScript client stack instead of adding Dart/Flutter.
- Keep `chrome-extension/shared/plan-command.ts` as the shared business-logic source of truth.
- Treat `renderer.js` and `chrome-extension/commands.js` as consumers of shared logic, not as separate recommendation engines.
- Add a dedicated Ruby recommendation endpoint instead of overloading only the current analyze route, while still enriching `analyze_and_suggest`.
- Introduce Ruby test tooling with `minitest` and `rack-test` because no Ruby test framework is currently configured.
- Preserve existing `/plan` command syntax and existing preset/template behavior unless explicitly extended.
- Generated JavaScript/build artifacts should be refreshed during execution only after source changes are complete.

## Verification Steps

1. Capture baseline benchmarks before any functional changes:
   - `node performance-tests/plan-command-benchmark.js --phase baseline`
   - `ruby performance-tests/ruby-plan-benchmark.rb --phase baseline`

2. Implement shared logic, IPC, UI, extension, and Ruby API changes in the files above.

3. Run source-level validation:
   - `npm run build:ts`
   - targeted JS tests for `/plan` and command handling
   - Ruby unit/API tests via `bundle exec ruby -Itest ...`

4. Run the same benchmark corpus after implementation:
   - `node performance-tests/plan-command-benchmark.js --phase after`
   - `ruby performance-tests/ruby-plan-benchmark.rb --phase after`

5. Compare baseline vs after snapshots and confirm the target improvements are met or document any shortfall with exact numbers.

6. Perform the final Ruby + TypeScript/JavaScript code-review pass and fix review findings before closing the task.
