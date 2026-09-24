# Camera Simulator — Exposure Lab

An interactive photography simulator. You stand in a 3D park with a
fictional full-frame camera, choose a lens, set aperture, shutter speed, ISO
and focus, and press the shutter. What you get is a photograph built by a
photographic pipeline (exposure, depth of field, motion over the shutter
interval, camera shake, sensor noise, tone curve). It is not a screenshot
with filters on top.

This is **Phase 1: the Exposure Lab** from the project handoff.

## Quick start

Requirements: Node.js 20+ and a browser with WebGL2 (any current Chrome,
Edge, Firefox or Safari). Works the same on Windows, macOS and Linux.

```sh
npm install
npm run dev        # open the printed URL
```

Other scripts:

| Command            | What it does                                              |
|--------------------|-----------------------------------------------------------|
| `npm test`         | Unit tests for the simulation maths (Vitest)              |
| `npm run typecheck`| TypeScript check                                          |
| `npm run build`    | Type-check and build a static site into `dist/`           |
| `npm run preview`  | Serve the production build                                |
| `npm run shots`    | Headless visual check: saves UI screenshots and photos A/B/C to `screenshots/` (needs a local Chrome/Chromium; set `CHROME_PATH` if it isn't found) |

Developer tools in `scripts/` (use a local Chrome/Chromium):
`views.mjs <views.json>` captures several scripted photos in one session, and
`probe.mjs <snippet.js>` runs a snippet against the live app and prints the result.
Both are useful for checking geometry, which is hard to judge by eye.

## Controls

Everything can be done with the on-screen panel. The keyboard shortcuts are:

| Input | Action |
|---|---|
| `W A S D` / arrows (`Shift` = faster) | Walk |
| Drag on the viewfinder | Look around |
| Click on the viewfinder | Move the AF point there and focus |
| `Space` / `Enter` | Shutter (autofocuses first in AF-S / AF-C) |
| `1` / `2` | Aperture wider / narrower (1/3 stop) |
| `3` / `4` | Shutter slower / faster |
| `5` / `6` | ISO down / up |
| `7` / `8` | Exposure compensation |
| `Q` / `E` | Previous / next lens |
| Mouse wheel | Zoom (zoom lens) · focus (in MF) |
| `M` | Cycle AF-S / AF-C / MF |
| `C` | Crouch |
| `T` | Tripod on/off |
| `I` | Stabilisation on/off |
| `G` `H` `Z` `P` `V` | Grid, histogram, zebras, focus peaking, DOF-zone overlay |
| `F` | Freeze the world (compose a moving scene) |
| `` ` `` | Performance stats |
| `R` | Review the last photo (`←`/`→` browse, `S` switches between what you saw and what the camera captured) |

## What to try

* **Aperture and depth of field.** Use the 85mm at f/1.4 focused on the subject, then f/8. Turn on the DOF-zone overlay (`V`).
* **Perspective vs focal length.** The *Perspective lesson* buttons walk you to where 24/50/85/200mm frame the subject the same size. The subject stays the same size while the background grows.
* **Motion.** Wait for the cyclist (or freeze the world with `F` while they pass). At 1/1000 the rider and spokes are frozen, at 1/30 they blur. Stabilisation and a tripod make no difference to that, because they steady the camera and not the subject.
* **Camera shake.** Turn stabilisation off and try the 200mm at 1/30, then put it on a tripod.
* **Noise.** Keep the same brightness at ISO 100 and at ISO 12800 (faster shutter), then compare them at 100% in review.
* **Exposure.** Zebras show where the sensor will clip. The histogram and the review notes explain what was lost.

## Documentation

* [Architecture](docs/architecture.md)
* [Camera simulation model](docs/camera-model.md): formulas, sources, calibration
* [Rendering pipeline](docs/rendering-pipeline.md)
* [Equipment data format](docs/equipment-format.md)
* [Known approximations](docs/known-approximations.md)
* [Decision log](docs/decisions.md)
