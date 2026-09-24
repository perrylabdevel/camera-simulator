# Decision log

### Web stack: TypeScript + three.js (WebGL2) + Vite + Vitest
*Why:* runs anywhere with a browser, zero install for users, same tooling
on Windows/macOS/Linux, npm scripts only. *Alternatives:* Unity/Unreal
(heavy, proprietary tooling, harder to embed), Babylon.js (also fine;
three.js has a larger ecosystem), WebGPU-only (not yet universal). The
pipeline is plain full-screen passes, so moving to WebGPU later is
straightforward.

### Simulation separate from rendering
`src/sim` has no three.js imports. The renderer gets plain numbers
(OpticalState/SensorState). This keeps the photographic model testable
and reusable.

### Absolute photometric units in the renderer
The scene is shaded in cd/m² (scaled by 1000). Exposure is then the real
ISO 12232 relationship rather than a tuned brightness slider, and the
meter's K = 12.5 calibration can be checked against sunny-16.

### Motion via temporal integration, not velocity-buffer blur
Rendering many sub-frames across the shutter interval gets subject blur,
wheel-spoke blur, shake, panning (later) and long exposures right from one
mechanism, and it matches how a sensor integrates light. The cost only
applies at capture. *Alternative:* per-pixel velocity blur. It is cheaper
but wrong for rotation, occlusion and shake, and it would be a separate
code path for each effect.

### Screen-space gather DOF (Gustafsson-style)
It is fast enough for live view and handles foreground/background ordering
reasonably. *Alternatives:* aperture-sampling accumulation (exact, but
needs hundreds of renders), scatter sprites (costly). This can be revisited
for captures later.

### Procedural assets only
There are no external model or texture downloads, which avoids licensing
questions and network dependence. People are the weakest asset; photoreal
humans are a planned upgrade (possibly CC0 scanned assets).

### Fictional equipment
Generic names avoid trademark and UI-copy issues, as the handoff requests.
