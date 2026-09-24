# Known approximations

The priority is correct relationships, not perfect physics. These are the
current deliberate shortcuts.

| Area | Approximation | Impact |
|---|---|---|
| Noise | One output pixel is treated as one photosite ("100 % view"). | Noise is visible at screen size. A downsampled 24 MP file would look ~3.5× cleaner. |
| Sensor colour | Render RGB is used as camera RGB. WB is fixed at daylight. | Colour is plausible but not a measured camera profile. |
| DOF | Screen-space gather, with CoC capped at 4.5 % of frame height. | Very close foregrounds wide open blur less than they should. Hidden background behind blurred foreground edges is not reconstructed. |
| Bokeh shape | Circular. Blade count is not used yet. | No polygonal bokeh or cat's-eye yet. |
| Focus breathing | FOV uses f, not the image distance. | Up to ~10 % framing change at MFD is ignored. |
| Long exposures | Up to 160 temporal samples. | Very long exposures of fast subjects show discrete ghosts rather than smooth trails. |
| Metering | The evaluative pattern is a documented heuristic. | Behaves sensibly; no real vendor's algorithm is copied. |
| Shadowing of sky light | Tree canopies approximate sky occlusion analytically (sphere solid angle). No SSAO. | Contact shadows under objects are soft or missing. |
| People | Procedural skinned bodies (one continuous mesh per figure), a sculpted head with a painted face, set-in eyes and a hair shell. Proportions and scale follow anthropometric averages. | Believable at portrait-to-full-body distances, but still stylised: no skin subsurface scattering, no fine facial detail, and hair is a shell plus a sheet rather than strands. |
| Wildlife | Gulls, pigeons and a squirrel are simple procedural models on scripted paths (circling, walk/peck, dart/pause). | Correct size, speed and wing-beat rate for shutter and AF lessons, but stylised. The animals don't react to the photographer. |
| Panning | Swing rate is taken from the view-drag input just before the press and held constant through the exposure. | No acceleration or wobble within the pan. The shake model is still added on top. |
| Diffraction | Formula implemented; not rendered at preview resolutions. | f/22 is not visibly softer yet. |
| Rolling shutter, flash, filters, AF performance | Not yet simulated. | Planned phases. |
| "What you saw" | Instant, eye-adapted to the meter, everything in focus. | A model of perception, not a physical camera. |
