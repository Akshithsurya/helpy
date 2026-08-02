<p align="center">
  <img src="assets/banner.svg" alt="Helpy banner" width="720">
</p>

<h1 align="center">Helpy</h1>

<p align="center"><i>A focus tool built for one person: whoever is using it right now.</i></p>

---

### What this actually is

Helpy is a desktop app paired with a Chrome extension. Together they watch what you're doing, hold you to the schedule you set for yourself, and log the results so you can see the pattern instead of guessing at it.

It is not a website. It is not a subscription. Nothing you do inside it leaves your machine unless you tell it to.

### Why it's built the way it is

Most focus apps live entirely inside the browser, which means closing the tab is all it takes to undo them. Helpy doesn't work that way. Each piece was picked because it's good at exactly one job, and the pieces don't trust each other blindly.

```
                         Chrome Extension (MV3)
                                  |
                                  v
                    Electron app, the orchestrator
                 /                              \
      C++ native addon                  background daemons
      blocks processes                  Erlang keeps schedule state
      at the OS level                   Ruby logs sessions and stats
```

**The native addon (C++, N-API)** talks to the OS directly. Browser-level blocking can be beaten by just opening a different browser or another app; this can't be, because it isn't watching the browser, it's watching the machine.

**The schedule engine (Erlang/OTP)** is the one source of truth for "what should be blocked right now." It runs as a small supervised daemon, so if it ever crashes it comes back on its own without losing state. The desktop app and the extension both check in with it rather than each keeping their own copy of the rules.

**The stats service (Ruby, Sinatra, SQLite)** writes down what happened. Sessions, blocked attempts, streaks. All of it lands in a local database file, nothing phoned home.

**The Electron shell** is the glue. It starts the daemons when you open the app, closes them when you quit, and gives you the window you actually look at.

**The Chrome extension** enforces the same rules inside the browser, checking in with the local Erlang service so the two never disagree.

There's also a stricter mode in here, referred to internally as Gov Mode, for the days when the regular settings aren't enough friction.

### If you just want to use it

Grab the latest build from the [Releases page](https://github.com/Akshithsurya/helpy/releases/latest) instead of building from source. The release zip has two parts:

- `app/` with the Windows installer, `Helpy Setup.exe`
- `chrome-extension/` to load into Chrome yourself, or a `.crx` if one's attached to that release

Run the installer for the app. For the extension, open `chrome://extensions`, turn on Developer mode, and use "Load unpacked" pointed at the `chrome-extension` folder, or drag in the `.crx` if there is one.

### Building it from source

You'll need:
- Node.js 18 or newer
- Erlang/OTP 24 or newer
- Ruby 3.0 or newer

Then:

```bash
npm install
npm start
```

To run the test suite:

```bash
npm test
```

This path is for development, not for day to day use. If you just want the app running, use the release above.

### Where things live

```
main.js, preload.js, renderer.js     the Electron app itself
focus-mode.js, block-scheduler.js    the rules that decide what's blocked and when
timer.js, habits.js, tasks.js        the day to day features
native/                              the C++ addon
erlang/                              the schedule engine
ruby-api/                            the stats service
chrome-extension/                    the MV3 extension
i18n/                                translations
gov-modules/                         the stricter accountability mode
shared/, src/                        shared code between the pieces
```

### On privacy

Everything stays local by default. Your task history, your session logs, your habits, all of it sits in files on your own disk. Anything that looks like a secret (API keys, tokens, the signing key for the extension) is kept out of version control on purpose, not by accident.

### Where it stands

This is still a project being built in the open, mostly by one person figuring it out as they go. Some of the daemons still need better error messages, the Chrome extension packaging is being cleaned up, and the docs you're reading now are being rewritten to actually sound like a person wrote them, because the first draft didn't.

If something breaks, open an issue and describe what you were doing when it happened. That's usually enough to track down.
