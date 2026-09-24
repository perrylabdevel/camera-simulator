# Equipment data format

Equipment lives in `src/data/*.json` and is validated at start-up
(`validateBody` / `validateLens` in `src/sim/equipment.ts`). All gear is
fictional.

## Body (`bodies.json`)

```json
{
  "id": "fx24",
  "name": "FX-24 Full-Frame Body",
  "sensor": {
    "format": "Full frame",
    "widthMm": 35.9, "heightMm": 23.9,
    "resolutionMp": 24.2,
    "baseIso": 100,
    "fullWellElectrons": 52000,
    "readNoiseElectrons": 2.6
  },
  "isoRange": [100, 25600],
  "shutterRange": [0.000125, 30],
  "ibisStops": 5,
  "aspect": 1.5
}
```

## Lens (`lenses.json`)

```json
{
  "id": "85-f1.4",
  "name": "85mm f/1.4 Prime",
  "focalRange": [85, 85],
  "maxAperture": 1.4,
  "maxApertureTele": 1.4,
  "minAperture": 16,
  "minimumFocusDistanceM": 0.85,
  "stabilizationStops": 0,
  "vignettingStopsWideOpen": 1.2,
  "apertureBlades": 9
}
```

* Zooms have `focalRange[1] > focalRange[0]`. Variable-aperture zooms set
  `maxApertureTele`.
* `apertureBlades` is stored for future bokeh-shape rendering.
