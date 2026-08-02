# Helpy

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:12141A,35:E8A33D,65:B98AF0,100:E8747A&height=220&section=header&text=Helpy&fontSize=58&fontColor=f2f4f8&animation=twinkling"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=18&pause=2200&center=true&vCenter=true&width=900&lines=A+focus+tool+built+for+one+person%3A+whoever+is+using+it+right+now.;Blocks+at+the+OS+level%2C+not+just+the+browser+tab.;Nothing+here+reports+home." />

</div>

---

## About

Most focus apps live entirely inside the browser, which means closing the tab undoes them. Helpy is a desktop app (Electron) paired with a Chrome extension that watches what you're actually doing, holds you to the schedule you set, and blocks the rest — at the operating-system level, so switching browsers or opening another app doesn't get you out of it.

It is not a website. It is not a subscription. It doesn't run in the cloud. Everything — tasks, habits, session logs, blocked-attempt counts — sits in files on your own machine. Windows only, for now, built mostly by one person during [Hack Club Stardance](https://hackclub.com).

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=transparent&height=30&section=header&animation=fadeIn"/>
</div>

---

## Get It

Casual users: skip the build. Grab the latest build from **[Releases](https://github.com/Akshithsurya/helpy/releases/latest)** — a single `release.zip` with two folders:

- `app/` — run `Helpy Setup.exe`, install like any other Windows app
- `chrome-extension/` — load into Chrome yourself: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → point it at the folder

If that release has a `.crx` attached, that's for self-hosted / policy-managed Chrome installs, not a normal consumer browser — for a regular install, "Load unpacked" is the one that actually works.

<div align="center">
<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=400&size=14&pause=3000&color=E8A33D&center=true&vCenter=true&width=700&lines=github.com/Akshithsurya/helpy/releases/latest;Local-only.+No+login.+No+telemetry." />
</div>

---

## Links

[![Repo](https://img.shields.io/badge/Repo-helpy-171a24?logo=github&logoColor=white)](https://github.com/Akshithsurya/helpy) [![Releases](https://img.shields.io/badge/Releases-latest-E8A33D?logo=github&logoColor=white)](https://github.com/Akshithsurya/helpy/releases/latest) [![Issues](https://img.shields.io/badge/Issues-open%20one-E8747A?logo=github&logoColor=white)](https://github.com/Akshithsurya/helpy/issues)

---

## Tech Stack

Five languages, each doing exactly one job — nothing here is picked for novelty.

![C++](https://img.shields.io/badge/c%2B%2B-%2300599C.svg?style=for-the-badge&logo=c%2B%2B&logoColor=white) ![Erlang](https://img.shields.io/badge/erlang-%23A90533.svg?style=for-the-badge&logo=erlang&logoColor=white) ![Ruby](https://img.shields.io/badge/ruby-%23CC342D.svg?style=for-the-badge&logo=ruby&logoColor=white) ![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E) ![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)

![Electron](https://img.shields.io/badge/electron-%2347848F.svg?style=for-the-badge&logo=electron&logoColor=white) ![CoffeeScript](https://img.shields.io/badge/coffeescript-%23244776.svg?style=for-the-badge&logo=coffeescript&logoColor=white) ![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white) ![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)

![Jest](https://img.shields.io/badge/jest-%23C21325.svg?style=for-the-badge&logo=jest&logoColor=white) ![ESLint](https://img.shields.io/badge/eslint-%234B32C3.svg?style=for-the-badge&logo=eslint&logoColor=white) ![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white) ![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white)

---

## Architecture

Each piece is good at exactly one job, and the pieces don't trust each other blindly:

<p align="center">
  <img src="assets/architecture.svg" alt="Chrome extension talks to the Electron orchestrator, which drives a C++ native addon and hands schedule and logging duties to Erlang and Ruby daemons" width="760">
</p>

**C++ native addon (N-API)** talks to the OS directly — kills blocked processes at the OS level, so it can't be beaten by just opening a different browser. **Erlang/OTP** is the one source of truth for "what's blocked right now," running as a supervised daemon that self-recovers on crash without losing state. **Ruby (Sinatra + SQLite)** logs sessions, blocked attempts, and streaks to a local database — nothing phoned home. **Electron** is the glue: starts the daemons, owns the window, ships updates. **The Chrome extension** enforces the same rules in-browser, checked against the same Erlang service so the two never disagree.

---

## What's Inside

| Module | What it does |
|---|---|
| **Focus Mode / Block Scheduler** | The rules that decide what's blocked and when, enforced by the C++ addon and the Erlang schedule engine |
| **Timer** | Focus session timing |
| **Tasks / Habits** | Day-to-day task manager with streaks, plus daily/weekly/monthly/custom-frequency habit tracking |
| **Activity Tracker** | Watches the active window/tab so session logs reflect what you actually did, not just what you scheduled |
| **Analytics** | Focus sessions, tasks completed, tabs tracked, apps used, reminders sent, daily streak — aggregated from the Ruby stats service |
| **Recommendations** | Flags known-distracting domains (YouTube, Reddit, X, Instagram, Facebook, Twitch, Netflix) with priority weighting |
| **Reminders** | Notification-based nudges on a fixed interval, personalized to your saved display name |
| **Bot Companion** | Remembers what you did, hands out tech/productivity facts, stays usable if the Ruby API is briefly down, and reads live diagnostics off the Erlang BEAM node |
| **Gov Mode** | A stricter accountability mode — styled like a government task-management portal — for the days the regular settings aren't enough friction |
| **i18n** | Translation layer |

---

## Roadmap

| Phase | Progress | What it is |
|---|---|---|
| Core app | ![100%](https://progress-bar.xyz/100/?title=Core&width=140&color=2E8B57) | Electron shell, timer, tasks, habits, reminders |
| OS-level blocking | ![100%](https://progress-bar.xyz/100/?title=Native&width=140&color=2E8B57) | C++ / N-API addon, process and window blocking |
| Schedule + stats engine | ![100%](https://progress-bar.xyz/100/?title=Backend&width=140&color=2E8B57) | Erlang/OTP schedule daemon, Ruby stats service |
| Chrome extension | ![90%](https://progress-bar.xyz/90/?title=Extension&width=140&color=E8B73A) | MV3 extension, packaging still being cleaned up |
| Self-hosted CRX updates | ![70%](https://progress-bar.xyz/70/?title=CRX&width=140&color=E8B73A) | Self-hosted update manifest for policy-managed Chrome |
| Daemon diagnostics | ![40%](https://progress-bar.xyz/40/?title=Diagnostics&width=140&color=0B3C5D) | Better error messages when a daemon fails to start |

Percentages are informal, one person's read on where things stand — update the bar values as phases actually move, not the text.

---

## Values

Constraints held to since the first commit, not aspirations:

1. **Local-only, always.** Tasks, habits, session logs, all of it on your disk. No cloud dependency, no remote telemetry.
2. **OS-level, not tab-level.** If it can be beaten by opening a new tab, it isn't real blocking. That's why the C++ addon exists at all.
3. **One job per service.** Erlang for state that must survive a crash, Ruby for logging and stats, C++ for the OS boundary. No service reaches past its own job.
4. **Secrets stay out on purpose.** API keys, tokens, the extension signing key — excluded from version control deliberately, checked, not assumed.
5. **Built in the open, imperfect on purpose.** This is one person's Stardance project, not a polished 1.0 pretending otherwise. The roadmap above says what isn't done yet.

---

## Building From Source

You'll need Node.js 18+, Erlang/OTP 24+, and Ruby 3.0+.

```bash
npm install
npm start          # run the app
npm test           # run the test suite
npm run build:win  # build the Windows installer + stage the extension
```

`build:win` leaves you with `release/app/` (the installer) and `release/chrome-extension/` (the unpacked extension) — the same two things the GitHub release ships. This path is for development, not day-to-day use; if you just want the app running, use [Get It](#get-it) above.

---

## Project Structure

```
main.js, preload.js, renderer.js     the Electron app itself
focus-mode.js, block-scheduler.js    the rules that decide what's blocked and when
timer.js, habits.js, tasks.js        the day to day features
activity-tracker.js, analytics.js    what you did and what it adds up to
recommendations.js, reminders.js     nudges and known-distracting-domain flags
bot-companion.js                     the facts-and-support companion
native/                              the C++ addon
erlang/                              the schedule engine
ruby-api/                            the stats service
chrome-extension/                    the MV3 extension
i18n/                                translations
gov-modules/                         the stricter accountability mode
shared/, src/                        shared code between the pieces
```

---

## Acknowledgements

- **[Hack Club Stardance](https://hackclub.com)** — the program this was built during
- **Erlang/OTP** — for "let it crash" being an actual production strategy, not just a slogan
- **N-API / node-addon-api** — for making the C++ boundary survivable
- **Everyone who's opened an issue** — that's usually enough to track a bug down



## Contact

GitHub issues are the fastest way to reach me — describe what you were doing when it broke, that's usually enough. [![Issues](https://img.shields.io/badge/Issues-open%20one-E8747A?logo=github&logoColor=white)](https://github.com/Akshithsurya/helpy/issues)

---

## License

`package.json` declares **ISC**, but there's no `LICENSE` file in the repo yet — worth adding one so the badge below actually means something legally, not just informally.

![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)

---

<div align="center">
Helpy · a focus tool for one person · built during Hack Club Stardance

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:E8747A,50:B98AF0,100:12141A&height=120&section=footer&animation=twinkling"/>
</div>
