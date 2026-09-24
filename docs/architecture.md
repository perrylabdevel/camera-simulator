# Architecture

```
src/
  sim/          Pure TypeScript photographic model. No three.js, no DOM.
    stops         1/3-stop aperture / shutter / ISO scales, formatting
    exposure      EV, meter equation, sensor saturation (ISO 12232)
    optics        FOV, crop factor, CoC, DOF, hyperfocal, blur disc, diffraction
    equipment     body/lens data model, limits, vignetting, validation
    camera        CameraSettings, constraining to equipment, stepping
    modes         M / A / S / P + Auto ISO solver
    metering      evaluative / centre-weighted / spot patterns
    whiteBalance  Planckian locus → WB gains, auto WB
    sensor        shot + read noise, dynamic range vs ISO
    shake         hand-tremor trajectory, stabilisation
    motion        blur estimates, temporal sample count
    critique      deterministic cause-and-effect photo notes
    assignments   outcome-based assignment criteria and evaluation
  data/         JSON: bodies, lenses, assignments. No code changes needed to add them.
  world/        Renderer-independent kinematics, all pure functions of time:
                bike path + cyclist, portrait sway, gulls, pigeons, squirrel.
  render/       three.js side.
    world/        The park: sky, trees, grass/flowers, props, humans (skinned),
                  bicycle + rider IK, wildlife rigs, shared material patches.
    shaders/      GLSL for the CoC, DOF, meter and develop passes.
    pipeline.ts   Live EVF render, meter readback, photograph capture.
  ui/           App shell (app.ts), control panel, EVF overlay, photographer
                movement, histogram, review/gallery, shutter sound.
tests/          Vitest tests for sim/ and world/.
scripts/        Headless tools: shots, views (multi-shot), probe (inspect live scene).
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
                 measured facts (clipping, blur px, distances, pan sweep,
                                 DOF, noise, light colour)
                                                         ▼
                   sim/critique → review notes · sim/assignments → pass/fail
```

The renderer only receives numbers the simulation computed: the blur
coefficient, the exposure scale, full-well electrons for this ISO, and so
on. It never decides photographic behaviour itself, so the model can be
reused with a different renderer (WebGPU, offline) or with none at all
(tests, analysis).

The UI loop also feeds the automatic parts of the camera. Every 4 frames
the meter grid is read back. From it, `sim/metering` produces the metered
luminance, `sim/modes` picks the automatic exposure settings for A/S/P or
Auto ISO, and `sim/whiteBalance` estimates the light colour for Auto WB.
Autofocus raycasts from the AF point against the scene (plus invisible
proxies for tree crowns and meadow patches).

## Camera motion during a capture

The capture receives an orientation function of time since the shutter
opened: the aim at the press, plus the photographer's swing rate
(panning), plus the hand-shake trajectory. The same function is used to
predict subject blur for the critique, so the notes and the rendered
photograph agree.

## Live view vs photograph

The live view behaves like a mirrorless EVF. It shows exposure, depth of
field and noise, but it is a single instant with no motion integration.
A capture integrates many renders across the real shutter interval, so
motion blur, shake and long exposures come from actual time integration.
Review can show both side by side ("what you saw" vs "what the camera
captured").
