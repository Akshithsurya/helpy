# Helpy Release Checklist

## Build Readiness

- Run `npm install`
- Run `npm test`
- Run `npm run lint`
- Run `npm run build:win`
- Confirm `release/app/` contains the expected Windows build artifacts
- Confirm `release/chrome-extension/` contains the unpacked Chrome extension
- Confirm runtime JSON files are not bundled into the release artifacts

## Desktop Smoke Tests

- Launch Helpy and verify the Welcome, Focus, Tasks, Tabs, and Settings sections load
- Resize the app to tablet-width, standard desktop, and large desktop sizes
- Save a preferred name and verify it appears in the greeting and task empty states
- Enable spoken reminders and confirm **Test Voice** works
- Verify keyboard-only navigation for tabs, forms, settings, and edit modal

## Tracking Smoke Tests

- Connect the Chrome extension and verify the desktop app shows a connected state
- Open several Chrome tabs and confirm the popup and desktop tabs view update
- Verify tab history and app history views render data
- Pause and resume tracking from the extension popup

## Reminder Smoke Tests

- Add a normal task and a daily task
- Trigger a daily summary test from the desktop app
- Verify reminder text remains readable when TTS is disabled
- Verify reminder speech is optional and does not block UI actions when enabled

## Accessibility Checks

- Verify visible focus states on interactive controls
- Verify dark mode and high-contrast combinations remain readable
- Verify reduced-motion settings remove decorative transitions
- Verify status changes are announced through live regions where applicable

## Release Sign-Off

- Confirm `INSTALL.md` matches the shipped setup flow
- Confirm `QA_MATRIX.md` has been executed or explicitly waived
- Confirm the packaged app creates new runtime data under the Electron user data directory
- Record any known issues before distribution
