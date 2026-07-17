<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:1b2433,100:3e7050&height=200&section=header&text=Helpy&fontSize=70&fontColor=ffffff&animation=fadeIn&fontAlignY=38" width="100%"/>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&size=20&pause=2000&color=3E7050&center=true&vCenter=true&width=600&lines=A+calm+corner+for+a+busy+brain.;Built+by+one+student+who+needed+it.;Free%2C+for+anyone+who+needs+it+too." alt="Typing SVG" />

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-1b2433.svg?style=for-the-badge&logo=gnu&logoColor=white)](LICENSE) [![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](#installation) [![Status](https://img.shields.io/badge/Status-v1.0_Released-3e7050?style=for-the-badge)](#roadmap) [![Cost](https://img.shields.io/badge/Cost_to_Use-₹0-1b2433?style=for-the-badge)](#values) [![No Tracking](https://img.shields.io/badge/Tracking-NONE-1b2433?style=for-the-badge&logo=mozilla&logoColor=white)](#values)

<img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=6,11,20&height=3&animation=fadeIn" width="100%"/>

</div>

## About

Most productivity apps are designed by people whose brains already do the organizing part for free. Helpy isn't that.

It's a desktop app (Electron) paired with a Chrome extension, built for people with ADHD. The hard part was never *wanting* to be productive, it was the fifteen-step setup, the color-coded systems, and the tools that demand the exact executive function that's already in short supply. Helpy tries to remove that tax. Tasks, timers, tabs, and reminders, in one place, staying quietly out of the way until they're needed.

Built by one student in Kerala who kept losing an afternoon to "just checking one thing" and got tired of pretending a sticky note was a system.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## See It Running

<!--
  Drop a screen recording here once you have one. ScreenToGif (Windows) or Kap (Mac) both export
  straight to GIF. A 10 to 15 second loop of opening a focus session and dismissing a reminder says
  more than any paragraph below it. Replace this comment block with:
  <p align="center"><img src="docs/demo.gif" width="720" alt="Helpy walkthrough"/></p>
-->

<p align="center"><em>Demo GIF in progress. See <a href="#roadmap">Roadmap</a>.</em></p>

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## Live

Helpy runs as a native Windows desktop app, with a companion Chrome extension for the browser side of the same problem: the tab that was supposed to be five minutes.

Both are distributed free, with no account required to use the core app, via **[GitHub Releases](https://github.com/Akshithsurya/helpy/releases)**.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## Installation

Everything ships in one archive: **`release.zip`** on the [Releases page](https://github.com/Akshithsurya/helpy/releases). Inside it are two folders: `app/` for the desktop installer, `chrome-extension/` for the browser side. Grab whichever one you need, or both.

### Option 1: Desktop app (recommended)

1. Go to the [Releases page](https://github.com/Akshithsurya/helpy/releases) and download `release.zip`
2. Unzip it, open the `app/` folder
3. Run **`Helpy Setup 1.0.0.exe`** and click through the installer
4. Open Helpy from your Start Menu

No terminal. No git. No dependencies to chase down.

> `app/` also contains `Helpy 1.0.0.exe` (unpacked build) and a `win-unpacked/` folder. Those are build artifacts, not what you run. The installer is `Helpy Setup 1.0.0.exe`.

### Option 2: Chrome extension

1. From the same `release.zip`, open the `chrome-extension/` folder
2. Open `chrome://extensions` in Chrome
3. Toggle on **Developer mode** (top right)
4. Click **Load unpacked**, select the `chrome-extension/` folder
5. Pin it to your toolbar. An extension you can't see is an extension you'll forget you installed

### Option 3: Build from source

```bash
git clone https://github.com/Akshithsurya/helpy.git
cd helpy
npm install
npm start
```

To produce your own installer:

```bash
npm run build
```

The packaged app lands in `dist/`.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## Tech Stack

Electron on the desktop, a lightweight vanilla-JS extension in the browser. No framework bloat where it isn't earning its keep.

<div align="center">

![Electron](https://img.shields.io/badge/Electron-191970?style=for-the-badge&logo=electron&logoColor=white) ![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white) ![JavaScript](https://img.shields.io/badge/javascript-%23323330.svg?style=for-the-badge&logo=javascript&logoColor=%23F7DF1E)

![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white) ![CSS3](https://img.shields.io/badge/css3-%231572B6.svg?style=for-the-badge&logo=css3&logoColor=white)

![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white) ![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white) ![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)

</div>

Packaged with `electron-builder`. Auth handled locally. No third-party analytics shipped in either the app or the extension.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## Feature Map

| Feature | What it does |
|---|---|
| **Focus sessions** | A timer that doesn't punish you for pausing it |
| **Task manager** | Catch the thought before it evaporates |
| **Tab tracker** | So "just five minutes of research" doesn't quietly become forty open tabs |
| **Reminders** | Nudges, not alarms |
| **Daily summary** | A soft landing at the end of the day, not a guilt trip |
| **Chrome extension** | Brings the same tab discipline and reminders into the browser, where the drift usually starts |

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## Team

### Akshith Surya: Builder
Grade 10, Palakkad, Kerala. NASA Space Apps 2025 Global Nominee and ISRO Space Week 1st Prize winner. Builds AI-powered exoplanet detection pipelines, hardware pentesting tools, and career-literacy platforms, and in between, a productivity app for a brain that doesn't work like the productivity apps assume it does. Helpy is the tool built to solve his own problem first.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## Roadmap

<div align="center">

![Progress](https://img.shields.io/badge/Overall_Progress-100%25-3e7050?style=for-the-badge)

<img src="https://capsule-render.vercel.app/api?type=rect&color=gradient&customColorList=6,11,20&height=8&animation=fadeIn" width="80%"/>

</div>

| Phase | Status | What it is |
|---|---|---|
| Phase 0 | Done | Core desktop app: tasks, timer, reminders, focus sessions |
| Phase 1 | Done | Chrome extension: tab tracking and browser-side reminders |
| Phase 1.5 | Done | Packaging and distribution: installer, GitHub Releases, install docs |
| Phase 2 | Done | Auto-updates via `electron-updater` |
| Phase 3 | Done | macOS and Linux builds |
| Phase 4 | Done | Optional sync between desktop app and extension state |

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## Values

These aren't aspirational. They're constraints held to since the first commit.

1. **Free, forever, for the core app.** No login required to use it. No paywalled features that matter.
2. **No tracking.** No analytics SDKs, no telemetry phoning home. What happens on your machine stays on your machine.
3. **Built for the brain it's built for.** Every design decision gets checked against one question: does this add friction for someone with ADHD, or remove it. If it adds friction, it doesn't ship.
4. **Honest, not decorative.** No dark patterns, no streak-shaming, no guilt-based notifications. Productivity tools that punish you for being human don't belong in this codebase.
5. **Open source.** GPL-3.0. Fork it, adapt it, take the pieces that solve your version of this problem.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## Contributing

Issues and PRs welcome, especially from people who've felt the specific kind of friction this app is trying to remove.

### Things that will get a fast merge

- Bug fixes, especially around the auth/session flow or the build process
- Accessibility improvements
- Anything that removes a step from the install or first-run experience

### Things that won't get merged

- Third-party analytics or tracking of any kind
- Features gated behind an account for no functional reason
- Notification patterns built on urgency, streaks, or guilt

If something about the flow feels like it's fighting your brain instead of helping it, that's a bug. Open an issue.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## Project Structure

```
.
├── main.js                    # Electron main process
├── renderer.js                 # UI logic
├── preload.js                  # Secure bridge between main and renderer
├── auth.js                     # Local auth handling
├── tasks.js / timer.js         # Core feature logic
├── focus-mode.js                # Focus session engine
├── chrome-extension/           # Companion browser extension
├── shared/                     # Code shared between app and extension
├── package.json
└── README.md                   # This file
```

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## Run Locally

```bash
git clone https://github.com/Akshithsurya/helpy.git
cd helpy
npm install
npm start
```

For the extension during development, load the `chrome-extension/` folder unpacked via `chrome://extensions`.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## Acknowledgements

- Everyone who's tried a dozen productivity apps and closed all of them within a week. This one's an attempt to be different.
- The open-source Electron and Node communities, for making a one-person desktop app achievable at all.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=1b2433&height=2&animation=fadeIn" width="60%"/>
</div>

## Contact

- **GitHub**: [github.com/Akshithsurya/helpy](https://github.com/Akshithsurya/helpy)
- **Issues**: for bugs, feature requests, and anything that feels like friction

I read everything. I reply slowly. I'm still in school.

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=rect&color=3e7050&height=2&animation=fadeIn" width="60%"/>
</div>

## License

Released under the **GPL-3.0 License**. See [LICENSE](LICENSE).

<div align="center">

> Helpy is a free, no-tracking desktop app and Chrome extension built to help people with ADHD stay on task without fighting their own tools to do it.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:3e7050,100:1b2433&height=120&section=footer&animation=fadeIn" width="100%"/>

Helpy · Palakkad, Kerala · 2026

</div>
