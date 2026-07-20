<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:1b2433,100:3e7050&height=200&section=header&text=Helpy&fontSize=70&fontColor=ffffff&animation=fadeIn&fontAlignY=38" width="100%"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=2000&color=3E7050&center=true&vCenter=true&width=600&lines=A+desktop+app+for+a+brain+that+won't+sit+still.;Built+by+one+student+who+needed+it.;Free%2C+for+anyone+who+needs+it+too." alt="Typing SVG" />

</div>

# Helpy

A desktop app and Chrome extension for staying on task if your brain doesn't cooperate with normal productivity tools.

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-1b2433.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6.svg)](#install)

## Why this exists

Every productivity app I tried wanted me to already have the executive function that a productivity app is supposed to give me. Fifteen-step onboarding, a color-coding system to learn before you can add a task, streaks that guilt you the first day you break them. I kept abandoning them within a week and going back to a sticky note, which is not a system.

Helpy is what I built instead: a timer, a task list, tab tracking, and reminders, running locally on my machine, with nothing phoning home. It's not polished and it's not finished. It's the tool I actually keep open.

## What it does

- **Focus sessions** — a timer. Pausing it doesn't reset your progress or shame you for pausing.
- **Tasks** — quick capture. No tags, no priority matrix, unless you want them.
- **Tab tracker** (Chrome extension) — flags when "let me just look one thing up" has turned into forty tabs. Uses `active-win` on the desktop side to know what you're actually looking at.
- **Reminders** — plain notifications through `node-notifier`, with an optional SMS nudge via Twilio for when a popup on screen isn't enough to break through.
- **Daily summary** — what got done today. No streak counter, no red numbers.

## Install

Everything ships as one `release.zip` on the [Releases page](https://github.com/Akshithsurya/helpy/releases). That's the only supported install path right now — don't `git clone` and expect it to run cleanly.

**Desktop app**
1. Unzip `release.zip`, open `app/`
2. Run `Helpy Setup 1.0.0.exe`
3. Open Helpy from the Start Menu

(`app/` also has `Helpy 1.0.0.exe` and a `win-unpacked/` folder — those are unpacked build output, not the installer. Run `Helpy Setup 1.0.0.exe`.)

**Chrome extension**
1. From the same zip, open `chrome-extentions/` — yes, that's really how the folder is named in this repo. I noticed the typo after wiring up the manifest paths and haven't renamed it, because that also means touching the build script and I didn't want to break the packaged release to fix a spelling mistake.
2. Go to `chrome://extensions`, turn on Developer mode
3. Load unpacked → select `chrome-extentions/`

## How it's built

Electron on the desktop side. The extension is vanilla JS — didn't want a framework's overhead for something that's mostly a popup and a background listener.

- **`main.js`** — Electron main process, owns the window, talks to disk for local storage.
- **`preload.js`** — bridge between `main.js` and the renderer so the UI doesn't get raw Node access.
- **`renderer.js`** — UI logic in the window.
- **`auth.js`** — local auth. Passwords go through `bcryptjs`, sessions through `jsonwebtoken`. There's a small local Express server (`express`, `body-parser`) that the desktop app and the Chrome extension both talk to, which is how state syncs between the two.
- **Feature modules** — `tasks.js`, `timer.js`, `focus-mode.js`, `focus-plan-manager.js`, `habits.js`, `reminders.js`, `notifications.js`, `history-store.js`, `inactivity-monitor.js`, each scoped to one behavior instead of one giant file.
- **`activity-tracker.js`, `data-tracking.js`, `system-monitor.js`, `logger.js`** — local session/activity state that feeds the daily summary and tab tracker, plus app logging. Nothing here leaves the machine.
- **`recommendations.js`, `personalization.js`, `settings.js`** — settings and the (still fairly basic) logic behind suggestions.
- **`chrome-extentions/`** — separate codebase from the Electron app, since a Chrome extension can't import Electron code directly. Talks to the local Express server for the tab-tracking and reminder sync.

State lives in flat JSON files next to the app (`tasks.json`, `settings.json`, `tab-history.json`, and similar) rather than a database — small dataset, one user, didn't need more than that.

## Where it actually is

Working: the desktop app, the extension, packaging, and auto-updates. What I haven't done real testing on: macOS and Linux builds exist because Electron gives them to you almost for free, but I run Windows day to day, so they've had far less real use than the Windows build. Sync between the desktop app and extension works for normal use but isn't built to survive editing the same task in both places at the same time — last write wins, no conflict resolution.

## Values

- Free, no login required for the core app
- No third-party analytics or telemetry — see [How it's built](#how-its-built) for what local tracking exists and why
- If a feature makes onboarding or daily use harder for someone with ADHD, it doesn't ship
- No streaks, no guilt notifications

## Contributing

Bug reports and PRs welcome, especially from people who've hit the specific friction this is trying to remove. Fast to merge: auth/build fixes, accessibility fixes, anything that shortens first-run setup. Won't merge: analytics or tracking of any kind, account-gating for no functional reason, streak or urgency-based notification patterns.

## Contact

Open an issue on [github.com/Akshithsurya/helpy](https://github.com/Akshithsurya/helpy) for bugs or requests. I'm in school, so replies aren't fast.

## License

GPL-3.0 — see [LICENSE](LICENSE). Fork it, take whatever's useful for your own version of this problem.

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:3e7050,100:1b2433&height=120&section=footer&animation=fadeIn" width="100%"/>

Helpy · Palakkad, Kerala · 2026
</div>
