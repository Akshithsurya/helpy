<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:1b2433,100:3e7050&height=200&section=header&text=Helpy&fontSize=70&fontColor=ffffff&animation=fadeIn&fontAlignY=38" width="100%"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=2000&color=3E7050&center=true&vCenter=true&width=600&lines=A+desktop+app+for+a+brain+that+won't+sit+still.;Built+by+one+student+who+needed+it.;Free%2C+for+anyone+who+needs+it+too." alt="Typing SVG" />

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-1b2433.svg?style=for-the-badge&logo=gnu&logoColor=white)](LICENSE) [![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](#install) [![Release](https://img.shields.io/badge/Release-v1.0-3e7050?style=for-the-badge)](https://github.com/Akshithsurya/helpy/releases)

</div>

## About

A desktop app + Chrome extension for staying on task if you have ADHD. Tasks, a timer, tab tracking, and reminders, running locally, with no login and no analytics SDK.

I built this because every productivity app I tried assumed I already had the executive function to use a productivity app. Fifteen-step onboarding, color-coded systems, streak counters that guilt-trip you the day you miss one. Helpy is my attempt at something that doesn't do that. It's not finished or perfect, but it's the tool I actually use.

## What it does

- **Focus sessions** — a timer, pausing doesn't reset it or shame you
- **Tasks** — quick capture, nothing fancier than it needs to be
- **Tab tracker** (Chrome extension) — flags when "quick research" has quietly turned into 40 tabs
- **Reminders** — plain notifications, not alarms
- **Daily summary** — what got done today, no streaks, no red numbers

## Install

Grab `release.zip` from the [Releases page](https://github.com/Akshithsurya/helpy/releases). That's the only supported way to install right now — there's no build-from-source path, so don't `git clone` and expect it to run cleanly.

**Desktop app**
1. Unzip `release.zip`, open the `app/` folder
2. Run `Helpy Setup 1.0.0.exe`
3. Open Helpy from the Start Menu

(`app/` also has an unpacked build and a `win-unpacked/` folder — ignore those, they're build output, not the installer. `Helpy Setup 1.0.0.exe` is the one you run.)

**Chrome extension**
1. Open the `chrome-extension/` folder from the same zip
2. Go to `chrome://extensions`, turn on Developer mode
3. Load unpacked → select `chrome-extension/`

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## How it's put together

Electron on the desktop side, a lighter vanilla-JS build for the extension — I didn't reach for a frontend framework since neither surface needed the overhead.

- **`main.js`** — the Electron main process. Owns the window and talks to the filesystem for local storage.
- **`preload.js`** — the bridge between `main.js` and the renderer, so the UI isn't handed raw Node access directly. Standard Electron security practice, not something I skipped.
- **`renderer.js`** — the UI logic running in the window.
- **`auth.js`** — local-only auth.
- **Feature modules** — `tasks.js`, `timer.js`, `focus-mode.js`, `focus-plan-manager.js`, `habits.js`, `reminders.js`, `notifications.js`, `history-store.js`, `inactivity-monitor.js` each own one piece of behavior rather than living in one giant file.
- **`activity-tracker.js`, `data-tracking.js`, `system-monitor.js`, `logger.js`** — local session/activity state (what you were doing, for the daily summary and tab tracker) and app logging. Local only, nothing third-party.
- **`recommendations.js`, `personalization.js`, `settings.js`** — the settings layer and the (currently basic) logic behind suggestions.
- **`chrome-extentions/`** — a separate codebase, since a Chrome extension can't import Electron code directly. Mirrors the reminder/tab-tracking behavior in the browser. (Yes, the folder name has a typo — "extentions" instead of "extensions." Haven't renamed it yet because that touches the build config too.)

Nothing calls out to a remote server. Data files (`tasks.json`, `settings.json`, `tab-history.json`, and similar) live next to the app, not in the cloud.

## Docs

More detail lives in these files if you want it:

- [`INSTALL.md`](INSTALL.md) — install steps in more depth
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — how the build was planned out
- [`GOOGLE_OAUTH_SETUP.md`](GOOGLE_OAUTH_SETUP.md) — OAuth setup, if you're working with that part
- [`QA_MATRIX.md`](QA_MATRIX.md) — what's been tested and on what
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — what has to happen before a release ships
- [`OPTIMIZATION_CHANGES.md`](OPTIMIZATION_CHANGES.md) — performance changes made along the way

## Where it's at

Core app, extension, packaging, and auto-updates are all working and shipped. macOS/Linux builds exist but get far less real-world testing than Windows, since that's what I actually run day to day. Sync between the desktop app and the extension works but isn't built to survive you editing the same task on both at once.

## Values

- Free to use, no login required for the core app
- No third-party analytics or telemetry — see [How it's put together](#how-its-put-together) for what local tracking exists and why
- If a feature adds friction for someone with ADHD, it doesn't ship
- No streaks, no guilt notifications, no dark patterns

## Contributing

Bug reports and PRs welcome, especially from people who've felt the specific friction this is trying to remove. Fast to merge: bug fixes around auth/build, accessibility fixes, anything that shortens first-run setup. Won't merge: third-party analytics or tracking, features locked behind an account for no real reason, anything built on urgency or streaks.

## Contact

GitHub: [github.com/Akshithsurya/helpy](https://github.com/Akshithsurya/helpy) — open an issue for bugs or feature requests. I'm in school, so replies aren't instant.

## License

GPL-3.0. See [LICENSE](LICENSE). Fork it, take whatever pieces are useful for your own version of this problem.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:3e7050,100:1b2433&height=120&section=footer&animation=fadeIn" width="100%"/>

Helpy · Palakkad, Kerala · 2026

</div>
