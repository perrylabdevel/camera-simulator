# Camera simulation model

All formulas live in `src/sim` and are unit-tested in `tests/`.

## Exposure (`sim/exposure.ts`)

* **Exposure value:** `EV100 = log2(N²/t) − log2(S/100)` (APEX / ISO 2720).
* **Meter:** reflected-light meter equation `N²/t = L·S/K`, with K = 12.5.
  This gives `EV100 = log2(L·100/12.5)`. A sunlit 18 % grey (~3500 cd/m²)
  meters ≈ EV 14.8, which agrees with the sunny-16 rule (tested).
* **Sensor signal:** saturation-based ISO (ISO 12232): `S = 78/H_sat`, with
  `H = q·L·t/N²` and q = 0.65, gives `L_sat = 1.2·2^EV100`. The normalised
  raw value is `L / L_sat`, where 1.0 means clipped. A correctly metered
  average lands at 0.104, i.e. about 3.3 stops of highlight headroom.
  (Also used by Lagarde & de Rousiers, *Moving Frostbite to PBR*, 2014.)
* The scene is rendered in absolute luminance (cd/m²; see
  `render/units.ts`), so exposure is a single multiply by `1/L_sat`.

## Scene photometry

* Sun: 85 000 lux direct-normal at ~40° elevation. Sky dome:
  ~3.5 kcd/m² at the zenith and ~8.5 kcd/m² at the horizon. Sunlit cloud
  tops: ~13 kcd/m².
* Ambient light is image-based from the same sky shader, so sky brightness
  and shade brightness are consistent.
* three.js physically based shading turns illuminance E into luminance
  `ρE/π` for Lambertian surfaces, which keeps the units consistent.

## Optics (`sim/optics.ts`)

* Angle of view: `2·atan(d/2f)`. The crop factor is 43.27 mm divided by
  the sensor diagonal.
* Acceptable circle of confusion: diagonal/1442 (0.030 mm on full frame).
* Hyperfocal distance: `H = f²/(N·c) + f`. DOF limits:
  `Dn = s(H−f)/(H+s−2f)`, `Df = s(H−f)/(H−s)`. Checked against DOFMaster
  values in the tests.
* Blur-disc diameter: `c = (f/N)·|S2−S1|/S2 · f/(S1−f)`. The renderer
  evaluates this per pixel from depth.
* Airy disk: `2.44·λ·N` (implemented; not yet used by the renderer at
  preview resolutions).

## Sensor (`sim/sensor.ts`)

* ISO is analogue gain. At ISO S the raw clip point is
  `Efs = fullWell·baseISO/S` electrons.
* Per pixel: shot noise `sqrt(e)` plus Gaussian read noise, both added in
  the linear raw domain before clipping and the tone curve.
* Consequences, with no special cases:
  * noise rises with ISO;
  * dynamic range `log2(Efs/read)` falls one stop per doubling of ISO;
  * underexposing and brightening later looks like high ISO.
* The FX-24 body uses a 52 000 e⁻ full well and 2.6 e⁻ read noise (typical
  of a modern 24 MP full-frame sensor). That gives ~14.3 stops of DR at
  ISO 100.

## Camera shake (`sim/shake.ts`)

* Hand tremor is a sum of sinusoids (0.6–11 Hz). Its RMS angular speed
  ω = 0.03 rad/s is calibrated to the reciprocal rule: blur equals one CoC
  at t = 1/f (tested).
* Stabilisation divides ω by 2^stops. Body and lens stabilisation together
  get the better system's stops +0.5. A tripod sets ω = 0.
* Stabilisation only affects camera rotation. Subject motion is untouched.

## Metering (`sim/metering.ts`)

* Centre-weighted: 75 % of the weight on a central circle.
* Spot: 3.5 % of the frame around the AF point.
* Evaluative: an 8×6 zone heuristic. Zones are clamped to 4× the median,
  with the centre and AF point emphasised. See the file header.

## Motion (`sim/motion.ts`)

* Image-plane blur = `v·t/d·f`. Blur is classified relative to the CoC in
  pixels (frozen / slight / blurred / streaked).
* A capture uses 12–160 temporal samples, chosen so that consecutive samples
  move less than ~1.5 px.

## Critique (`sim/critique.ts`)

The critique is deterministic. It uses what the simulator knows: clipped
fractions from the actual photo, subject distances along the axis,
measured image-plane motion, defocus blur, shake blur, and mid-tone SNR.
Each note states the cause and what would change it.

## Exposure modes (`sim/modes.ts`)

* Target: `EV100_target = meter − exposure compensation`, using the APEX
  relation `log2(N²) + log2(1/t) = EV100 + log2(S/100)`.
* **A:** the photographer sets N; the camera solves t. **S:** the
  photographer sets t; the camera solves N. **P:** a program line that
  stays wide open until t reaches 1/focal, then splits further light
  equally between aperture and shutter.
* **Auto ISO:** starts at base ISO and raises it only as far as needed to
  keep t ≤ 1/focal (reciprocal rule), capped at the chosen maximum. In M,
  Auto ISO picks the ISO for the chosen N and t.
* Results snap to the body and lens 1/3-stop scales. If the target is out
  of range by more than 1/3 stop, the camera reports `too-bright` /
  `too-dark` (shown as HI/LO in the viewfinder).

## Panning

The photographer's angular velocity over the last ~0.15 s before the
press is extrapolated through the exposure. The capture renders each
sub-frame with the camera rotated by `ω·t`, plus shake. Subject blur is
then measured relative to the moving frame, and background sweep is
`|ω|·t·f` on the sensor. The critique compares the swing rate with the
subject's angular rate (the rate that would have tracked it). *Tracking
assist* substitutes that ideal rate, to show what a perfect pan looks like.

## White balance (`sim/whiteBalance.ts`)

* Colour temperature → chromaticity: the Planckian-locus cubic spline of
  Kim et al. (2002), valid 1667–25 000 K. Then xy → XYZ → linear sRGB
  (IEC 61966-2-1). The tests check it against CIE reference points
  (illuminant A, 6500 K).
* The renderer's RGB white is D65, so the gains are
  `rgb(6504 K) / rgb(T)` per channel, with green = 1. 6504 K gives unit gains.
* **Presets:** Daylight 5500, Cloudy 6500, Shade 7500, Tungsten 3200,
  Fluorescent 4000, Flash 5500, plus manual Kelvin.
* **Auto:** grey-pixel estimation over the meter grid. Only bright cells
  on nearby surfaces count, and only if their colour lies on the Planckian
  locus. Sky and hazy distance are excluded because they are skylight, not
  surfaces, and green grass fails the locus test. With too little neutral
  content the camera falls back to 5500 K.
* Scene lighting uses measured colours: afternoon sun ≈ 5200 K, clear-sky
  zenith ≈ 20 000 K, horizon ≈ 7800 K. Open shade is therefore genuinely
  blue under Daylight WB.
* "What you saw" always uses auto WB (the eye adapts). The critique flags
  casts above ~60 mired.
