# Helpy Installation Guide

## Supported Release

- Platform: Windows desktop app
- Browser integration: Google Chrome extension only
- Data model: Local-only storage for tasks, settings, tab history, and app history

## Option 1: Install A Packaged Windows Build

1. Build the app from the project root with `npm run build:win`.
2. Open the generated installer or portable package from `release/app/`.
3. Complete the install flow and launch Helpy.
4. Open the Settings page on first run to configure:
   - your preferred name
   - accessibility preferences
   - spoken reminders (optional)
   - auto-start and daily summary behavior

## Option 2: Run In Development

1. Install dependencies with `npm install`.
2. Start the desktop app with `npm start`.
3. Keep the app running while you connect the Chrome extension.

## Install The Chrome Extension

### From A Release Build

1. Run `npm run build:win`.
2. Open Google Chrome.
3. Navigate to `chrome://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select `release/chrome-extension`.
7. Confirm the extension popup shows Helpy and that the desktop app reports the extension connection.

### From The Source Tree

1. Open Google Chrome.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the project's `chrome-extension` folder.
6. Confirm the extension popup shows Helpy and that the desktop app reports the extension connection.

## First-Run Checklist

1. Save your preferred name in the Helpy Settings page.
2. Confirm the Welcome page greeting updates.
3. Enable spoken reminders if you want text-to-speech output.
4. Use **Test Voice** and **Test Now** for daily summary verification.
5. Open the Chrome extension popup and confirm it shows a connected bridge state.

## Troubleshooting

### Extension shows "App unavailable"

- Confirm the Helpy desktop app is running.
- Re-open the extension popup.
- If needed, use the popup reconnect action or reopen the desktop app Settings page.

### Name does not sync to the extension

- Save your name again in the desktop app.
- Open the extension options page and save once to refresh the secure local bridge state.

### Spoken reminders do not play

- Confirm **Enable spoken reminders** is checked in the desktop app Settings page.
- Use **Test Voice** to verify speech synthesis is available on the current machine.
- If no system voice is available, Helpy continues using text-only reminders.

### Activity tracking looks empty

- Confirm Chrome is open with active tabs in the current window.
- Confirm the Chrome extension is loaded and enabled.
- Use the desktop app **Refresh Tabs** action to force a manual UI refresh.

## Production Verification Commands

- `npm test`
- `npm run lint`
- `npm run build:win`
- Confirm `release/app/` contains the Windows artifacts
- Confirm `release/chrome-extension/` contains the unpacked Chrome extension
