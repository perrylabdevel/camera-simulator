# Camera Simulator — Exposure Lab

An interactive photography simulator. You stand in a 3D park with a
fictional full-frame camera, choose a lens, set aperture, shutter speed, ISO
and focus, and press the shutter. What you get is a photograph built by a
photographic pipeline (exposure, depth of field, motion over the shutter
interval, camera shake, sensor noise, tone curve). It is not a screenshot
with filters on top.

The current build is the **Exposure Lab**: one detailed park scene with
one fictional full-frame body and five lenses. It covers Phase 1 of the
project handoff completely. It also covers most of Phase 2 (first-person
photographer), most of Phase 3 (camera simulation), the core of Phase 4
(assignments) and panning from Phase 6. See [docs/status.md](docs/status.md)
for what is done and what is left.

### What's in it

* **Scene:** a sunny park lit in absolute photometric units. It has a
  portrait subject, a passing cyclist, circling gulls, feeding pigeons, a
  squirrel, trees, a meadow, a white pavilion and deep shade.
* **Camera:** M / A / S / P modes with Auto ISO, 1/3-stop aperture, shutter
  and ISO, and exposure compensation. Metering can be evaluative,
  centre-weighted or spot (which follows the AF point).
  * White balance: Auto, presets or Kelvin.
  * Focus: AF-S, AF-C or MF.
  * Stabilisation, tripod, crouching.
  * Lenses: 24mm, 35mm, 50mm, 85mm and a 70–200mm zoom.
* **Photographs:** built by integrating light over the real shutter time.
  That gives motion blur, spinning wheels, wing beats, camera shake and
  panning. The photo then goes through thin-lens depth of field, a sensor
  noise model, highlight clipping, white balance and a camera tone curve.
* **Viewfinder:** live exposure preview, meter scale, histogram, zebras,
  focus peaking, DOF-zone overlay and grid.
* **Review:** photo details, RGB histogram, "what you saw vs what the
  camera captured", A/B compare, 100% zoom and download. It also shows a
  deterministic critique that explains cause and effect.
* **Training:** seven outcome-based assignments, plus perspective and
  panning lessons. Sandbox shooting is always available.

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
| `npm test`         | Unit tests for the simulation maths, kinematics, modes, white balance, critique and assignments (Vitest, ~100 tests) |
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
| Drag on the viewfinder | Look around (keep dragging while you shoot to pan) |
| Click on the viewfinder | Move the AF point there and focus |
| `Space` / `Enter` | Shutter (autofocuses first in AF-S / AF-C) |
| `1` / `2` | Aperture wider / narrower (1/3 stop) |
| `3` / `4` | Shutter slower / faster |
| `5` / `6` | ISO down / up |
| `7` / `8` | Exposure compensation |
| `Q` / `E` | Previous / next lens |
| Mouse wheel | Zoom (zoom lens) · focus (in MF) |
| `M` | Cycle AF-S / AF-C / MF |
| `X` | Cycle exposure mode M / A / S / P |
| `O` | Auto ISO on/off |
| `B` | Cycle white balance |
| `C` | Crouch |
| `T` | Tripod on/off |
| `I` | Stabilisation on/off |
| `G` `H` `Z` `P` `V` | Grid, histogram, zebras, focus peaking, DOF-zone overlay |
| `F` | Freeze the world (compose a moving scene) |
| `` ` `` | Performance stats |
| `R` | Review the last photo (`←`/`→` browse, `S` switches between what you saw and what the camera captured) |

## What to try

* **Assignments.** Pick a goal in the *Assignments* panel, such as freezing the cyclist, panning, a portrait with background separation, or freezing a gull's wings. Every photo is judged on the result, never on the settings. *Hint* gives a nudge, and sandbox shooting is always available.

* **Aperture and depth of field.** Use the 85mm at f/1.4 focused on the subject, then f/8. Turn on the DOF-zone overlay (`V`).
* **Perspective vs focal length.** The *Perspective lesson* buttons walk you to where 24/50/85/200mm frame the subject the same size. The subject stays the same size while the background grows.
* **Motion.** Wait for the cyclist (or freeze the world with `F` while they pass). At 1/1000 the rider and spokes are frozen, at 1/30 they blur. Stabilisation and a tripod make no difference to that, because they steady the camera and not the subject.
* **Exposure modes.** In A you choose the aperture and the camera picks the shutter. In S it's the other way round. P picks both, and Auto ISO raises ISO to keep the shutter at 1/focal length or faster. "HI"/"LO" in the viewfinder means the camera has run out of range.
* **Panning.** Use *Panning lesson → Go to the path*, wait for the cyclist, drag to follow, and press Space mid-swing. The camera keeps turning during the exposure, so a good pan gives a sharp rider and a streaked background. *Tracking assist* shows what a perfect pan looks like.
* **White balance.** Try Tungsten in daylight, or walk into the tree shade with Daylight WB to see how blue open shade really is. The *Colour* panel shows the camera's estimate of the light.
* **Wildlife.** Gulls circle overhead: a telephoto at 1/2000 freezes their wing beats and 1/60 smears them. Pigeons feed near the bench, and a squirrel darts across the lawn by the big tree.
* **Camera shake.** Turn stabilisation off and try the 200mm at 1/30, then put it on a tripod.
* **Noise.** Keep the same brightness at ISO 100 and at ISO 12800 (faster shutter), then compare them at 100% in review.
* **Exposure.** Zebras show where the sensor will clip. The histogram and the review notes explain what was lost.

The quality preset can also be set from the URL: `?quality=low|medium|high|ultra`.

## Documentation

* [Status and roadmap](docs/status.md): what's implemented and what's left

* [Architecture](docs/architecture.md)
* [Camera simulation model](docs/camera-model.md): formulas, sources, calibration
* [Rendering pipeline](docs/rendering-pipeline.md)
* [Equipment data format](docs/equipment-format.md)
* [Assignment format](docs/assignment-format.md)
* [Known approximations](docs/known-approximations.md)
* [Decision log](docs/decisions.md)
