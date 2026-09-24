# Architecture

```
src/
  sim/        Pure TypeScript photographic model. No three.js, no DOM.
              exposure, optics (FOV, DOF, CoC), sensor noise, shake, motion,
              metering patterns, camera settings/limits, deterministic critique.
  data/       Equipment as JSON (bodies, lenses). No code changes needed to add gear.
  world/      Renderer-independent kinematics (bike path, cyclist, subject sway).
              Pure functions of time so captures can sample any instant.
  render/     three.js side.
    world/    The Exposure Lab park: sky, trees, grass, people, bicycle, props.
    shaders/  GLSL for CoC, DOF, meter and develop passes.
    pipeline.ts  Live EVF render and photograph capture.
  ui/         App shell, control panel, EVF overlay, review/gallery.
tests/        Vitest tests for sim/ and world/.
scripts/      Headless screenshot/capture tools.
```

## Data flow

```
CameraSettings (sim/camera) ──► resolveExposure / optics / sensor maths (sim)
                                           │
                       OpticalState + SensorState (plain numbers)
                                           ▼
World time t ──► world/actors ──► render/world rigs ──► PhotoPipeline
                                                         │
                               live: 1 frame → EVF canvas
                               capture: N frames across the shutter interval
                                        → accumulate light → develop → JPEG
                                                         │
                             measured facts (clipping, blur px, distances)
                                                         ▼
                                    sim/critique → review notes
```

The renderer only receives numbers the simulation computed: the blur
coefficient, the exposure scale, full-well electrons for this ISO, and so
on. It never decides photographic behaviour itself, so the model can be
reused with a different renderer (WebGPU, offline) or with none at all
(tests, analysis).

## Live view vs photograph

The live view behaves like a mirrorless EVF. It shows exposure, depth of
field and noise, but it is a single instant with no motion integration.
A capture integrates many renders across the real shutter interval, so
motion blur, shake and long exposures come from actual time integration.
Review can show both side by side ("what you saw" vs "what the camera
captured").
