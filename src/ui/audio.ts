/** Synthesised shutter sound (no audio assets). */

let ctx: AudioContext | null = null;

export function playShutter(durationS: number, muted: boolean): void {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const click = (at: number, gain: number) => {
      const len = Math.floor(ctx!.sampleRate * 0.035);
      const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
      const src = ctx!.createBufferSource();
      src.buffer = buf;
      const filter = ctx!.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2400;
      filter.Q.value = 0.9;
      const g = ctx!.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(ctx!.destination);
      src.start(ctx!.currentTime + at);
    };
    click(0, 0.5);
    // Second curtain: audible gap for slow shutter speeds.
    click(Math.min(Math.max(durationS, 0.02), 1.2), 0.4);
  } catch {
    /* audio unavailable — ignore */
  }
}
