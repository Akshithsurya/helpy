# Helpy — Focus Management Desktop App & Chrome Extension

Helpy is an open-source productivity and focus management suite featuring an Electron desktop application, a Manifest V3 Chrome Extension, and a polyglot backend architecture.

---

## 🏗️ Multi-Language Architecture & Rationale

Helpy uses a multi-language architecture where each service is built using the optimal programming language for its specific domain requirements:

```
                                  ┌──────────────────────────┐
                                  │   Chrome Extension MV3   │
                                  └─────────────┬────────────┘
                                                │ (HTTP / Local API)
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                           Electron Main Orchestrator                           │
│  ┌─────────────────────────────┐    ┌───────────────────────────────────────┐  │
│  │ C++ Native Addon (N-API)    │    │ Subprocess Lifecycle Manager          │  │
│  │ - OS Process/Window Blocker │    │ - Launches Erlang & Ruby Daemons      │  │
│  │ - Hard Mode Focus Lock      │    │ - Auto-Launch & Auto-Updater           │  │
│  └─────────────────────────────┘    └──────────────────┬────────────────────┘  │
└────────────────────────────────────────────────────────┼───────────────────────┘
                                                         │
                        ┌────────────────────────────────┴────────────────────────────────┐
                        ▼                                                                 ▼
┌───────────────────────────────────────────────┐               ┌───────────────────────────────────────────────┐
│       Erlang/OTP Sync & Schedule Engine       │               │        Ruby Stats & Session Log Service       │
│ - Canonical Schedule State Machine            │──────────────>│ - Focus Session Start/Stop Event Logging      │
│ - Rule Evaluation ("9-5 Weekdays")            │  (HTTP Event) │ - Blocked-attempt Metrics                     │
│ - Self-recovers on Crash via OTP Supervision  │               │ - Weekly Focus Hours & Streak Calculations    │
└───────────────────────────────────────────────┘               └───────────────────────────────────────────────┘
```

### 1. C++ Native Module (`node-addon-api` / N-API) — OS-Level Enforcement Layer
- **Why C++?**: DOM and web-level URL blocking inside browser extensions can easily be bypassed by opening another browser, launching distracting desktop software, or killing the Electron renderer.
- **Role**: C++ executes at the native OS layer using Windows APIs (`CreateToolhelp32Snapshot`, `TerminateProcess`) to monitor and block OS processes and window titles.
- **Hard Mode**: Implements a native, thread-safe Hard Mode countdown (60–120s delay) or password lock that cannot be bypassed even if the UI is closed or disconnected.

### 2. Erlang/OTP Service — Sync & Scheduling Engine
- **Why Erlang?**: Managing focus schedules and session state across multiple concurrent clients (Electron desktop UI + Chrome background service worker) requires an immutable, fault-tolerant state machine.
- **Role**: Erlang/OTP runs as a local background daemon under OTP supervision (`gen_server` / `supervisor`). If a crash occurs, Erlang self-recovers immediately without loss of schedule state.
- **Rule Evaluation**: Server-side rule evaluation ("block social media 9-5 weekdays") ensures both the desktop app and Chrome Extension execute against a single canonical source of truth.

### 3. Ruby Service (Sinatra + SQLite) — Stats & Session Logging
- **Why Ruby?**: Logging time-series event data and generating aggregated metrics (streaks, weekly focus hours, blocked attempts) is best handled by a flexible database layer with expressive analytics syntax.
- **Role**: Lightweight Sinatra service with a local SQLite database (`helpy_stats.db`). Stores session logs on-device without cloud dependency or remote telemetry.

### 4. JavaScript / Electron — Orchestrator & UI Layer
- **Role**: Electron acts as the orchestrator. It manages the application window, exposes IPC channels to the desktop UI, automatically launches background Erlang & Ruby daemons on startup, and shuts them down cleanly on app quit. Also handles auto-launch on system startup and auto-updates (`electron-updater`).

### 5. Chrome Extension (Manifest V3) — Browser Integration
- **Role**: Connects directly to the Erlang OTP sync service (`http://localhost:8080`) for canonical schedule state and blocking rules, operating consistently whether the desktop app window is open or minimized.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Erlang/OTP 24+
- Ruby 3.0+

### Installation & Execution

1. **Install Node dependencies**:
   ```bash
   npm install
   ```

2. **Start the Electron application**:
   ```bash
   npm start
   ```

3. **Run tests**:
   ```bash
   npm test
   ```

---

## 🔐 Security & Privacy
- **Local-Only Storage**: All user data, task history, and analytics stay local on-device.
- **Secret Isolation**: Configuration and environment secrets are excluded from version control via `.gitignore`.
