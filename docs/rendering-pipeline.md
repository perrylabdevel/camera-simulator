# Rendering pipeline (`src/render/pipeline.ts`)

1. **Scene pass** renders into a half-float target (MSAA ×4 for live view).
   Values are absolute luminance / 1000 (kcd/m²). There is no tone mapping.
2. **CoC pass** turns depth into view distance z and computes the signed
   blur radius in pixels: `0.5·K·(z − s)/z` (K from `sim/optics`, converted
   to pixels via sensor height). Negative means in front of the focus
   plane. Colour is clamped at 400 kcd/m² to avoid fireflies.
3. **DOF gather** (after Gustafsson, "Bokeh depth of field in a single
   pass", 2018): a golden-angle spiral gather in linear HDR. Samples behind
   the centre pixel are limited to twice its CoC, so a sharp subject never
   gets smeared background over it, while foreground blur spreads over
   sharp areas. The sample spacing adapts to a per-quality budget. A
   per-pixel rotated spiral turns undersampling into noise, which capture
   accumulation averages away. Bright highlights become bokeh discs
   naturally because blurring happens before exposure and clipping.
4. **Develop pass:** exposure scale → vignetting (lens data, fades when
   stopped down) → shot + read noise in electrons → per-channel clip at
   raw 1.0 → white balance → tone curve (extended Reinhard with white at
   raw clip, putting metered mid-grey at display 0.18) → +10 % saturation →
   sRGB → mild S-curve. Live-only overlays: zebras, peaking, DOF zone.
5. **Meter:** the scene target is reduced to a 48×32 luminance grid and
   read back every 4 frames. The metering pattern is applied on the CPU.

## Capture

A capture renders N sub-frames at stratified times across `[t0, t0 + shutter]`.
Each sub-frame has:

* the world advanced to that time (cyclist, wheels, cranks, grass, clouds);
* camera rotation offset by the shake trajectory;
* sub-pixel projection jitter for anti-aliasing;
* its own CoC + DOF pass.

The results are summed with ONE/ONE blending into a float target (alpha
holds CoC, so ordinary alpha blending must not be used). Develop and noise
run once on the integrated light, as on a real sensor. A second image,
"what you saw", is rendered as a single instant, eye-adapted, with no DOF
and no noise.

## Performance budgets

* Live: target 60 fps on a mid-range desktop GPU at Medium. The main costs
  are the DOF gather (bounded by `dofBudget` samples/pixel), grass
  instances and the 4K shadow map at High+.
* Quality presets (Low/Medium/High/Ultra) change live resolution cap,
  grass density, tree-line count, shadow resolution, DOF budget and
  capture resolution. The photographic maths is identical at every
  quality level.
* The `` ` `` key shows fps, CPU frame time, draw calls, triangles and
  texture count.
