# Status and roadmap

This tracks the build against the phases in the project handoff.
✅ done · 🟡 partly done · ⬜ not started.

## Summary

| Phase | Status |
|---|---|
| 1. Exposure Lab | ✅ Complete |
| 2. First-person photographer | ✅ Mostly (no controller or touch movement yet) |
| 3. Camera simulation | 🟡 Most of it (AF is idealised; RAW and sensor classes not yet) |
| 4. Scenario system | 🟡 Assignments done; multi-scene scenarios not yet |
| 5. Equipment | 🟡 Lenses done; one body only; no flash, filters or lights |
| 6. Advanced photography | 🟡 Panning done; the other items not started |
| 7. Training / career | ⬜ Not started (flat assignment list only) |

## Phase 1: Exposure Lab ✅

* ✅ One detailed scene: a sunny park with portrait subject, cyclist,
  wildlife, foreground meadow, deep shade, bright pavilion and layered trees.
* ✅ Fictional full-frame body. Lenses: 24mm, 35mm, 50mm, 85mm and a
  70–200mm zoom.
* ✅ Aperture, shutter and ISO in 1/3 stops, with real ranges and lens and
  body limits.
* ✅ Correct field of view; thin-lens depth of field; exposure calibrated
  to ISO 12232 and the K = 12.5 meter constant (checked against sunny-16).
* ✅ Motion blur from real time integration across the shutter.
* ✅ Exposure meter, histogram, capture, review with photo details and A/B
  compare.
* ✅ The reference photos A/B/C from the handoff show the intended effects.
  With the handoff's exact settings they are 3–6 stops overexposed in full
  sun, which is physically correct, and the critique says so.

## Phase 2: First-person photographer ✅

* ✅ Walking (keyboard), looking (drag), crouching, positioning.
* ✅ Electronic-viewfinder view with overlays; lens switching; photo review.
* ✅ Perspective lesson (24/50/85/200mm at equal framing).
* ⬜ Raising and lowering the camera to the eye as a separate action. You
  are always looking through the camera.
* ⬜ Gamepad support, touch movement controls, rebindable keys.

## Phase 3: Camera simulation 🟡

* ✅ Exposure modes M / A / S / P, Auto ISO (minimum shutter 1/focal, max ISO).
* ✅ Exposure compensation. Metering: evaluative, centre-weighted, spot.
* ✅ White balance: Auto, six presets, Kelvin.
* ✅ Stabilisation (body + lens) that affects camera shake only; tripod.
* ✅ Sensor noise (shot + read noise), dynamic range falls with ISO,
  highlight clipping.
* ✅ Manual focus, focus peaking, DOF-zone overlay, distance and DOF readout.
* 🟡 Autofocus: AF-S, AF-C and a movable AF point work, but AF is idealised.
  ⬜ low-light or low-contrast failure, ⬜ AF speed differences,
  ⬜ face/eye detection, ⬜ subject tracking that moves the AF point,
  ⬜ focus magnification.
* ⬜ RAW vs JPEG output and a RAW development step.
* ⬜ Multiple sensor classes in use (APS-C, MFT, medium format). The data
  model and crop-factor maths support them.
* ⬜ Diffraction softening in the rendered image (the formula exists).
* ⬜ Program shift; configurable Auto ISO minimum shutter; highlight-weighted
  metering.

## Phase 4: Scenario system 🟡

* ✅ Reusable, data-driven assignment format (`src/data/assignments.json`,
  docs/assignment-format.md) with outcome-based criteria and deterministic
  scoring.
* ✅ Seven assignments, with the result shown in the toast and review.
  Progress is saved in the browser.
* ✅ Deterministic instructor critique explaining cause and effect.
* ⬜ Scenario files that also set up the environment (time of day,
  weather, which subjects appear). Today every assignment shares the park.
* ⬜ Optional AI coaching that rewrites the deterministic notes in natural
  language.

## Phase 5: Equipment 🟡

* ✅ Data-driven lenses and bodies with validation.
* ⬜ More bodies: entry APS-C, sports, high-resolution, medium-format-like.
  Each would differ in noise, resolution, burst rate and AF.
* ⬜ Flash (built-in, hot-shoe, off-camera, TTL, high-speed sync, rear curtain).
* ⬜ ND, graduated ND and polariser filters.
* ⬜ Reflectors and studio lights.
* 🟡 Tripod: works as a shake-removal toggle, but has no physical placement.

## Phase 6: Advanced photography 🟡

* ✅ Panning (swing continues through the exposure, tracking assist, critique).
* ⬜ Long exposures that need more light control: ND filters, and smooth
  trails beyond 160 sub-frames.
* ⬜ Night, astrophotography, star motion.
* ⬜ Waterfall / water smoothing (no water in the scene).
* ⬜ Studio lighting, flash photography, sports/concert scenes.
* ⬜ Burst shooting, rolling-shutter effects.

## Phase 7: Training / career ⬜

* ⬜ Structured progression (exposure basics → focus → DOF → motion → …),
  with sandbox always available.
* ⬜ Saving photos, preferences and bindings (only assignment completion is
  saved today).

## Cross-cutting

* ✅ Cross-platform tooling (Node + npm scripts only), fictional equipment,
  data-driven design, documentation.
* ✅ Quality presets (Low / Medium / High / Ultra) and a performance overlay.
* ✅ ~100 unit tests for the maths, kinematics and scoring. There are also
  headless visual-check scripts: shots, views and probe.
* 🟡 Performance has only been measured under software rendering (headless
  SwiftShader). It still needs profiling on real desktop and mobile GPUs.
* 🟡 Responsive layout exists, but touch interaction beyond look and tap
  to focus is minimal.
* ⬜ Visual regression tests against reference images.
* ⬜ Additional environments: studio, wedding reception, night city,
  waterfall, stadium, etc.

## Suggested next steps (highest value first)

1. **Save photos across reloads** (IndexedDB), and save preferences.
2. **Profile on real GPUs** and tune the quality presets; decide the mobile
   target.
3. **Realistic autofocus:** failure in low light and low contrast, eye
   detection on the portrait, AF-C tracking that follows the subject.
4. **RAW + JPEG** with a simple RAW development panel. It builds directly
   on the existing sensor and develop stages.
5. **ND filter + tripod long exposures.** This also needs a scene element
   that rewards them (fountain or stream), and better trails for very long
   shutters.
6. **Second body (APS-C)** to teach crop factor and sensor-size effects on
   noise and DOF.
7. **Lighting:** flash, then a second environment (evening or indoor)
   where low light, high ISO and mixed white balance matter.
8. **Structured progression** built from the existing assignments.
