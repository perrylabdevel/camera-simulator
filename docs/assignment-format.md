# Assignment format

Assignments live in `src/data/assignments.json` and are validated at
start-up (`validateAssignment` in `src/sim/assignments.ts`). They state a
photographic **outcome**. Criteria never check settings directly, so any
combination that produces the result passes. That matches the handoff's
rule of teaching through experiment rather than recipes.

```json
{
  "id": "pan-cyclist",
  "title": "Pan with the cyclist",
  "brief": "Keep the rider reasonably sharp while the background streaks behind them.",
  "hint": "Follow the rider with the camera and keep swinging through the exposure…",
  "setup": { "x": 1.5, "z": -0.2, "lookAt": { "x": 1.5, "y": 1.0, "z": -4.5 }, "lensId": "50-f1.8" },
  "criteria": [
    { "kind": "inFrame", "subject": "cyclist", "minSize": 0.12 },
    { "kind": "frozen", "subject": "cyclist", "maxBlur": 4 },
    { "kind": "panStreak", "minPx": 30 },
    { "kind": "exposure", "maxStops": 1 }
  ]
}
```

`setup` only positions the photographer (and optionally mounts a lens).
Exposure and focus are always left to the player.

## Criteria

Blur limits written as multiples (`maxBlur`) are relative to the circle of
confusion in output pixels. Absolute limits are in output pixels (`…Px`).

| kind | passes when |
|---|---|
| `inFrame` | the named subject is in frame and at least `minSize` of the frame height (default 0.05) |
| `frozen` | subject motion during the exposure ≤ `maxBlur` × CoC (default 1.5) |
| `motionBlur` | subject motion ≥ `minPx` |
| `inFocus` | subject defocus blur ≤ `maxBlur` × CoC |
| `panStreak` | panning swept the background ≥ `minPx` |
| `staticBackground` | pan sweep and shake both ≤ `maxPx` |
| `backgroundBlur` | blur discs of the distant background ≥ `minFrac` of the frame height |
| `deepFocus` | the depth of field reaches infinity and starts within `maxNearM` |
| `exposure` | within `maxStops` of the meter, highlight clipping ≤ `maxHighlightClip`, shadow clipping ≤ `maxShadowClip` |
| `noShake` | camera-shake blur ≤ `maxBlur` × CoC |
| `clean` | mid-tone SNR ≥ `minSnr` |

Subject names match the scene's subjects: `portrait subject`, `cyclist`,
`gull`, `pigeon`, `squirrel`. When several subjects share a name, the
largest one in frame is judged.

Completed assignments are remembered in the browser (`localStorage`).
Sandbox shooting is always available and is never scored.
