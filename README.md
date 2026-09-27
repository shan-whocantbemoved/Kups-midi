# Blue Note MIDI Setlist

A local-first stage setlist PWA with a small Python standard-library server. The browser app handles Web MIDI, IndexedDB, service-worker caching, and the ambient audio engine; those APIs cannot run in Python, so the Python file is the local host.

## Run

To open the app itself without any testing interface, run:

```powershell
npm start
```

Then open <http://127.0.0.1:4173>. This shows only the Blue Note app. Alternatively, use the Python standard-library server with Python 3.8 or newer:

```powershell
py -3 server.py
```

Open <http://127.0.0.1:8000>. To use another port, run `py -3 server.py --port 8080`.

Web MIDI is supported in Chromium-based browsers such as current Chrome and Edge, over localhost. Ambient audio starts only after a user gesture. The app remains usable without MIDI hardware.

## Included

- Installable PWA manifest, keyboard-mark SVG icon, and offline app-shell service worker.
- IndexedDB persistence for setlists, songs, layers, scenes, MIDI mappings, and installed preset packs.
- Setlist and patch creation, rename, duplicate, delete, search, snapshots, layer mix controls, tempo, key, and volume.
- Web MIDI device hot-plug detection, MIDI learn, mapping save, and overwrite confirmation.
- Ambient drone player with root key, attack, release, tone, and power controls.
- Downloadable JSON preset packs with quota checks and installed-preset import.

Preset packs describe patch and layer configurations. Instrument audio is supplied by connected MIDI instruments or other software; the ambient player uses the browser audio engine.

## Playwright browser tests

Install the Node.js dependencies once with `npm install`, then run the real Chromium end-to-end suite:

```powershell
npm test
```

To watch the actual Blue Note app in one Chromium window while Playwright runs its tests, use:

```powershell
npm run test:headed
```

For the interactive Playwright runner, where you can choose tests and inspect steps, use:

```powershell
npm run test:ui
```

The headed test opens one Chromium window, not the Playwright dashboard. Its app server starts automatically on `http://127.0.0.1:4173` and stops when the test command exits. The Playwright dashboard is a separate optional mode (`npm run test:ui`). After a run, open the HTML results with `npm run test:report`. Screenshots, video, and traces are saved for failed tests under `test-results/`.

In VS Code, open **Terminal → Run Task** and choose **Playwright: UI mode**, **Playwright: Run tests**, or **Playwright: Show report**.

The current local Playwright UI is available at <http://127.0.0.1:9323> while the `test:ui` task is running. The suite currently covers four flows: setlist/layer/scene persistence, preset pack install/import, no-MIDI phone layout, and the PWA manifest/service worker.
