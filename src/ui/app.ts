/**
 * Application shell: wires the renderer-independent camera simulation
 * (src/sim) to the 3D world (src/render) and the UI.
 */

import * as THREE from 'three';
import bodiesData from '../data/bodies.json';
import lensesData from '../data/lenses.json';
import {
  availableApertures,
  availableIsos,
  availableShutters,
  constrainSettings,
  resolveExposure,
  stepStop,
  totalStabilizationStops,
  type CameraSettings,
  type FocusMode,
  type MeteringMode,
} from '../sim/camera';
import type { BodySpec, LensSpec } from '../sim/equipment';
import { isZoom, validateBody, validateLens, vignettingStops } from '../sim/equipment';
import { meterOffsetStops, meteredEv100, sensorExposureScale, settingsEv100, METERED_MIDTONE_SIGNAL } from '../sim/exposure';
import { meterLuminance } from '../sim/metering';
import { blurCoefficientMm, blurDiscMm, circleOfConfusionMm, depthOfField, verticalFovDeg } from '../sim/optics';
import { fullScaleElectrons, snr } from '../sim/sensor';
import { createShakeTrajectory, shakeAngularSpeed } from '../sim/shake';
import { temporalSampleCount } from '../sim/motion';
import { critique, type SubjectFacts } from '../sim/critique';
import { randomSeed } from '../sim/random';
import assignmentsData from '../data/assignments.json';
import { evaluateAssignment, validateAssignment, type Assignment, type ShotMeasure, type SubjectMeasure } from '../sim/assignments';
import { solveExposure, type ExposureMode } from '../sim/modes';
import { formatAperture, formatDistance, formatShutter } from '../sim/stops';
import { PhotoPipeline, type OpticalState, type Overlays, type SensorState } from '../render/pipeline';
import { buildExposureLab, PORTRAIT_POSITION, type LabScene, type Quality, type Subject } from '../render/world/park';
import { Photographer } from './photographer';
import { EvfOverlay } from './evf';
import { Panel } from './panel';
import { Gallery, type Photo, type PhotoMeta } from './review';
import { computeHistogram } from './histogram';
import { playShutter } from './audio';
import { el } from './dom';

const bodies = bodiesData as BodySpec[];
const lenses = lensesData as LensSpec[];
const assignments = assignmentsData as Assignment[];
const COMPLETED_KEY = 'camsim.completedAssignments';

function loadCompleted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function saveCompleted(s: Set<string>): void {
  try {
    localStorage.setItem(COMPLETED_KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

const CAPTURE_SIZES: Record<Quality, [number, number]> = {
  low: [1200, 800],
  medium: [1800, 1200],
  high: [2400, 1600],
  ultra: [3000, 2000],
};
const LIVE_MAX_WIDTH: Record<Quality, number> = { low: 1100, medium: 1500, high: 2000, ultra: 2600 };
const DOF_BUDGET: Record<Quality, number> = { low: 110, medium: 180, high: 260, ultra: 360 };
const INFINITY_M = 10000;

interface UiState {
  quality: Quality;
  grid: boolean;
  zebra: boolean;
  peaking: boolean;
  dofZone: boolean;
  histogram: boolean;
  stats: boolean;
  noisePreview: boolean;
  freeze: boolean;
  muted: boolean;
  /** Panning aid: the capture rotates exactly with the subject under the AF point. */
  trackAssist: boolean;
}

interface FocusHit {
  distanceM: number;
  name: string;
}

export class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly pipeline: PhotoPipeline;
  private lab!: LabScene;
  private readonly camera = new THREE.PerspectiveCamera(40, 1.5, 0.05, 3000);
  private readonly photographer = new Photographer();
  private readonly evf: EvfOverlay;
  private readonly panel: Panel;
  private readonly gallery: Gallery;
  private readonly raycaster = new THREE.Raycaster();

  settings: CameraSettings;
  ui: UiState = {
    quality: 'medium',
    grid: true,
    zebra: false,
    peaking: false,
    dofZone: false,
    histogram: true,
    stats: false,
    noisePreview: true,
    freeze: false,
    muted: false,
    trackAssist: false,
  };

  private worldTime = 0;
  private lastFrame = performance.now();
  private meteredLuminance = 3000;
  private focusTarget: number;
  private afHit: FocusHit | null = null;
  private afState: 'idle' | 'focused' | 'miss' = 'idle';
  private capturing = false;
  private frameCount = 0;
  private fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private cpuMs = 0;
  private hint: string | null = 'Drag to look · WASD to walk · click to focus · Space to shoot';
  private photoId = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly viewfinder: HTMLElement,
    overlay: HTMLElement,
    bar: HTMLElement,
    panelRoot: HTMLElement,
    filmstrip: HTMLElement,
    reviewRoot: HTMLElement,
  ) {
    const errors = [...bodies.flatMap(validateBody), ...lenses.flatMap(validateLens), ...assignments.flatMap(validateAssignment)];
    if (errors.length) throw new Error(`Invalid equipment data:\n${errors.join('\n')}`);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pipeline = new PhotoPipeline(this.renderer);

    this.settings = {
      mode: 'M',
      autoIso: false,
      autoIsoMax: 12800,
      bodyId: bodies[0].id,
      lensId: '50-f1.8',
      focalLengthMm: 50,
      apertureNominal: 4,
      shutterNominal: 1 / 500,
      isoNominal: 100,
      exposureCompensation: 0,
      focusDistanceM: 7.8,
      focusMode: 'AF-S',
      afPoint: { x: 0.5, y: 0.45 },
      metering: 'evaluative',
      stabilization: true,
      support: 'handheld',
    };
    this.focusTarget = this.settings.focusDistanceM;

    this.evf = new EvfOverlay(overlay, bar);
    this.panel = new Panel(panelRoot);
    this.gallery = new Gallery(filmstrip, reviewRoot, () => this.canvas.focus());
    this.raycaster.layers.enableAll();
    this.buildPanel();
    this.bindInput();
  }

  get body(): BodySpec {
    return bodies.find((b) => b.id === this.settings.bodyId)!;
  }

  get lens(): LensSpec {
    return lenses.find((l) => l.id === this.settings.lensId)!;
  }

  async start(onStatus: (s: string) => void): Promise<void> {
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') this.ui.quality = q;
    onStatus('Growing trees and grass…');
    await new Promise((r) => setTimeout(r, 20));
    this.lab = buildExposureLab(this.renderer, this.ui.quality);
    this.photographer.obstacles = [
      { x: PORTRAIT_POSITION.x, z: PORTRAIT_POSITION.z, r: 0.45 },
      { x: 13, z: -11, r: 4.0 },
      { x: -9.5, z: 3.5, r: 0.8 },
    ];
    this.photographer.place(0.6, 10.2);
    this.photographer.lookAt(new THREE.Vector3(0, 1.25, 2));
    this.pipeline.dofBudget = DOF_BUDGET[this.ui.quality];
    onStatus('Compiling shaders…');
    await new Promise((r) => setTimeout(r, 20));
    this.resize();
    this.renderFrame(0);
    this.acquireFocus();
    new ResizeObserver(() => this.resize()).observe(this.viewfinder);
    this.panel.refresh();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      if (!this.capturing) this.renderFrame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Jump the world clock (used by lessons and automated tests). */
  seek(t: number): void {
    this.worldTime = t;
    this.lab.setTime(t);
  }

  get time(): number {
    return this.worldTime;
  }

  /* ---------------------------------------------------------------------- */
  /* Derived camera state                                                    */
  /* ---------------------------------------------------------------------- */

  private exact() {
    return resolveExposure(this.settings, this.body, this.lens);
  }

  private optics(): OpticalState {
    const s = this.body.sensor;
    const e = this.exact();
    return {
      focalMm: this.settings.focalLengthMm,
      aperture: e.aperture,
      focusDistanceM: this.settings.focusDistanceM,
      sensorWidthMm: s.widthMm,
      sensorHeightMm: s.heightMm,
      blurCoefficientMm: blurCoefficientMm(this.settings.focalLengthMm, e.aperture, this.settings.focusDistanceM),
      cocLimitMm: circleOfConfusionMm(s),
    };
  }

  private sensorState(noise: boolean): SensorState {
    const e = this.exact();
    return {
      exposureScale: sensorExposureScale(e),
      vignetteStops: vignettingStops(this.lens, this.settings.focalLengthMm, e.aperture),
      fullScaleElectrons: fullScaleElectrons(this.body.sensor, e.iso),
      readNoiseElectrons: this.body.sensor.readNoiseElectrons,
      noise,
      whiteBalance: [1, 1, 1],
    };
  }

  /** Eye-adapted exposure used for the "what you saw" frame. */
  private eyeSensorState(): SensorState {
    const ev = meteredEv100(this.meteredLuminance);
    const e = { aperture: 4, shutter: 1, iso: 100 };
    e.shutter = (e.aperture * e.aperture) / 2 ** ev;
    return { exposureScale: sensorExposureScale(e), vignetteStops: 0, fullScaleElectrons: 1e9, readNoiseElectrons: 0, noise: false, whiteBalance: [1, 1, 1] };
  }

  private overlays(): Overlays {
    return { zebra: this.ui.zebra, peaking: this.ui.peaking, dofZone: this.ui.dofZone };
  }

  private meterStops(): number {
    return meterOffsetStops(this.exact(), this.meteredLuminance, this.settings.exposureCompensation);
  }

  private dof() {
    return depthOfField(this.settings.focalLengthMm, this.exact().aperture, this.settings.focusDistanceM, circleOfConfusionMm(this.body.sensor));
  }

  /* ---------------------------------------------------------------------- */
  /* Frame                                                                   */
  /* ---------------------------------------------------------------------- */

  private liveSize(): [number, number] {
    const rect = this.viewfinder.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.max(64, Math.round(rect.width * dpr));
    w = Math.min(w, LIVE_MAX_WIDTH[this.ui.quality]);
    const h = Math.round(w / this.body.aspect);
    return [w, h];
  }

  private resize(): void {
    const [w, h] = this.liveSize();
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
  }

  private updateCamera(): void {
    const s = this.body.sensor;
    this.camera.fov = verticalFovDeg(this.settings.focalLengthMm, s);
    this.camera.aspect = s.widthMm / s.heightMm;
    this.camera.updateProjectionMatrix();
    this.photographer.apply(this.camera);
  }

  private renderFrame(dt: number): void {
    const t0 = performance.now();
    if (!this.ui.freeze) this.worldTime += dt;
    this.photographer.update(dt);
    this.recordAim();
    this.lab.setTime(this.worldTime);
    this.updateCamera();

    // Continuous AF tracks whatever is under the AF point.
    if (this.settings.focusMode === 'AF-C') this.acquireFocus(false);
    // Focus motor: approach the target distance quickly in dioptres.
    if (this.settings.focusMode !== 'MF') {
      const cur = 1 / this.settings.focusDistanceM;
      const tgt = 1 / this.focusTarget;
      const k = Math.min(1, dt * 18);
      this.settings.focusDistanceM = Math.max(this.lens.minimumFocusDistanceM, 1 / (cur + (tgt - cur) * k || 1e-4));
    }

    const [w, h] = this.liveSize();
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    const optics = this.optics();
    const sensor = this.sensorState(this.ui.noisePreview);
    this.pipeline.renderLive(this.lab.scene, this.camera, optics, sensor, this.overlays(), w, h);

    this.frameCount++;
    if (this.frameCount % 4 === 0) {
      const grid = this.pipeline.readMeter();
      const L = meterLuminance({ width: PhotoPipeline.METER_W, height: PhotoPipeline.METER_H, values: grid.mean }, this.settings.metering, this.settings.afPoint);
      // Smooth in log space like a real meter's integration time.
      const a = this.frameCount < 8 ? 1 : 0.35;
      this.meteredLuminance = Math.exp(Math.log(this.meteredLuminance) * (1 - a) + Math.log(Math.max(L, 1e-3)) * a);
      this.applyAutoExposure();
      if (this.ui.histogram) {
        const img = this.pipeline.readLiveHistogramImage(sensor, optics);
        this.evf.showHistogram(computeHistogram(img));
      } else this.evf.showHistogram(null);
    }
    this.updateAfState();
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.updateEvf();
    if (this.frameCount % 10 === 0) this.panel.refresh();
  }

  private updateAfState(): void {
    if (!this.afHit) {
      this.afState = 'idle';
      return;
    }
    const c = blurDiscMm(this.settings.focalLengthMm, this.exact().aperture, this.settings.focusDistanceM, this.afHit.distanceM);
    this.afState = c <= circleOfConfusionMm(this.body.sensor) ? 'focused' : this.settings.focusMode === 'MF' ? 'idle' : 'miss';
  }

  private updateEvf(): void {
    const s = this.settings;
    const e = this.exact();
    const dof = this.dof();
    const info = this.renderer.info;
    this.evf.update({
      mode: s.mode + (this.aeLimited ? (this.aeLimited === 'too-bright' ? ' HI' : ' LO') : ''),
      shutter: formatShutter(s.shutterNominal),
      aperture: formatAperture(s.apertureNominal).replace('f/', 'F'),
      iso: `ISO ${s.autoIso ? 'A ' : ''}${s.isoNominal}`,
      meterStops: this.meterStops(),
      ec: s.exposureCompensation,
      afMode: s.focusMode,
      focal: `${Math.round(s.focalLengthMm)}mm`,
      metering: s.metering === 'evaluative' ? '◉ eval' : s.metering === 'center' ? '◎ ctr' : '• spot',
      wb: 'WB ☀',
      support: s.support === 'tripod' ? 'TRIPOD' : s.stabilization ? 'IS ON' : 'IS OFF',
      afPoint: s.afPoint,
      afState: this.afState,
      afContinuous: s.focusMode === 'AF-C',
      spot: s.metering === 'spot',
      topLeft: `${this.lens.name}\nfocus ${formatDistance(s.focusDistanceM)}${this.afHit ? ` · AF: ${this.afHit.name} ${formatDistance(this.afHit.distanceM)}` : ''}`,
      topRight: `DOF ${formatDistance(dof.nearM)} – ${formatDistance(dof.farM)}\nEV100 ${settingsEv100(e).toFixed(1)} · scene ${meteredEv100(this.meteredLuminance).toFixed(1)}`,
      grid: this.ui.grid,
      stats: this.ui.stats
        ? `${this.fps.toFixed(0)} fps · cpu ${this.cpuMs.toFixed(1)} ms\ndraws ${info.render.calls} · tris ${(info.render.triangles / 1e6).toFixed(2)}M\nlive ${this.canvas.width}×${this.canvas.height} · tex ${info.memory.textures}\nt ${this.worldTime.toFixed(1)} s · eye ${this.photographer.position.y.toFixed(2)} m`
        : null,
      hint: this.hint,
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Focus                                                                   */
  /* ---------------------------------------------------------------------- */

  private raycastAf(): FocusHit | null {
    const p = this.settings.afPoint;
    this.raycaster.setFromCamera(new THREE.Vector2(p.x * 2 - 1, -(p.y * 2 - 1)), this.camera);
    const hits = this.raycaster.intersectObjects(this.lab.focusTargets, true);
    if (!hits.length) return { distanceM: INFINITY_M, name: 'sky' };
    const hit = hits[0];
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const d = hit.point.clone().sub(this.camera.position).dot(forward);
    let o: THREE.Object3D | null = hit.object;
    let name = '';
    while (o && !name) {
      name = o.name;
      o = o.parent;
    }
    return { distanceM: Math.max(0.05, d), name: name || 'object' };
  }

  /** Autofocus at the AF point (instant = snap immediately, e.g. on shutter press). */
  acquireFocus(instant = true): void {
    const hit = this.raycastAf();
    this.afHit = hit;
    if (!hit || this.settings.focusMode === 'MF') return;
    const target = Math.max(this.lens.minimumFocusDistanceM, Math.min(INFINITY_M, hit.distanceM));
    this.focusTarget = target;
    if (instant) this.settings.focusDistanceM = target;
  }

  /* ---------------------------------------------------------------------- */
  /* Settings                                                                */
  /* ---------------------------------------------------------------------- */

  change(patch: Partial<CameraSettings>): void {
    const lensChanged = patch.lensId && patch.lensId !== this.settings.lensId;
    this.settings = { ...this.settings, ...patch };
    if (lensChanged) {
      const l = this.lens;
      this.settings.focalLengthMm = isZoom(l) ? Math.min(l.focalRange[1], Math.max(l.focalRange[0], this.settings.focalLengthMm)) : l.focalRange[0];
    }
    this.settings = constrainSettings(this.settings, this.body, this.lens);
    this.applyAutoExposure();
    if (patch.focusDistanceM !== undefined) this.focusTarget = this.settings.focusDistanceM;
    if (lensChanged && this.settings.focusMode !== 'MF') this.acquireFocus();
    this.panel.refresh();
  }

  private step(kind: 'aperture' | 'shutter' | 'iso' | 'ec', delta: number): void {
    const s = this.settings;
    if (this.isAuto(kind)) {
      this.hint = `${kind === 'iso' ? 'ISO' : kind === 'aperture' ? 'Aperture' : 'Shutter speed'} is chosen by the camera in ${s.mode}${kind === 'iso' ? ' with Auto ISO' : ''} mode`;
      return;
    }
    if (kind === 'aperture') this.change({ apertureNominal: stepStop(availableApertures(this.lens, s.focalLengthMm), s.apertureNominal, delta) });
    if (kind === 'shutter') this.change({ shutterNominal: stepStop(availableShutters(this.body), s.shutterNominal, delta) });
    if (kind === 'iso') this.change({ isoNominal: stepStop(availableIsos(this.body), s.isoNominal, delta) });
    if (kind === 'ec') this.change({ exposureCompensation: Math.round((s.exposureCompensation + delta / 3) * 3) / 3 });
  }

  selectAssignment(id: string): void {
    this.activeAssignment = id;
    this.showHint = false;
    const a = assignments.find((x) => x.id === id);
    this.hint = a ? `Assignment: ${a.brief}` : null;
    this.panel.refresh();
  }

  /** True when the camera, not the photographer, controls this setting. */
  isAuto(kind: 'aperture' | 'shutter' | 'iso' | 'ec'): boolean {
    const m = this.settings.mode;
    if (kind === 'aperture') return m === 'S' || m === 'P';
    if (kind === 'shutter') return m === 'A' || m === 'P';
    if (kind === 'iso') return this.settings.autoIso;
    return false;
  }

  /** Let the camera choose the automatic settings for the current mode. */
  private applyAutoExposure(): void {
    const s = this.settings;
    if (s.mode === 'M' && !s.autoIso) {
      this.aeLimited = null;
      return;
    }
    const r = solveExposure({
      mode: s.mode,
      targetEv100: meteredEv100(this.meteredLuminance) - s.exposureCompensation,
      apertureNominal: s.apertureNominal,
      shutterNominal: s.shutterNominal,
      isoNominal: s.isoNominal,
      autoIso: s.autoIso,
      autoIsoMax: s.autoIsoMax,
      autoIsoMinShutter: 1 / Math.max(1, s.focalLengthMm),
      apertures: availableApertures(this.lens, s.focalLengthMm),
      shutters: availableShutters(this.body),
      isos: availableIsos(this.body),
    });
    s.apertureNominal = r.apertureNominal;
    s.shutterNominal = r.shutterNominal;
    s.isoNominal = r.isoNominal;
    this.aeLimited = r.limited;
  }

  private aeLimited: 'too-bright' | 'too-dark' | null = null;
  /** Active assignment id, or '' for free sandbox shooting. */
  activeAssignment = '';
  private completed = loadCompleted();
  private showHint = false;

  private cycleLens(delta: number): void {
    const i = lenses.findIndex((l) => l.id === this.settings.lensId);
    const j = (i + delta + lenses.length) % lenses.length;
    this.change({ lensId: lenses[j].id });
  }

  /** Walk to where `focal` frames the portrait waist-up, like a photographer would. */
  private perspectiveStation(lensId: string, focal: number): void {
    const subject = PORTRAIT_POSITION;
    const facing = new THREE.Vector3(Math.sin(-0.3), 0, Math.cos(-0.3));
    const frameHeight = 1.25;
    const d = (frameHeight * focal) / this.body.sensor.heightMm;
    const pos = subject.clone().addScaledVector(facing, d);
    this.photographer.place(pos.x, pos.z);
    this.photographer.lookAt(new THREE.Vector3(subject.x, 1.3, subject.z));
    this.change({ lensId, focalLengthMm: focal, afPoint: { x: 0.5, y: 0.3 } });
    this.updateCamera();
    this.acquireFocus();
    this.hint = `${focal}mm from ${d.toFixed(1)} m — compare how big the background looks`;
  }

  /* ---------------------------------------------------------------------- */
  /* Capture                                                                 */
  /* ---------------------------------------------------------------------- */

  async shoot(): Promise<void> {
    if (this.capturing) return;
    this.capturing = true;
    this.hint = null;
    const shutterBtn = document.getElementById('shutter-btn') as HTMLButtonElement | null;
    if (shutterBtn) shutterBtn.disabled = true;
    const blackout = document.getElementById('blackout')!;
    const progress = el('div', { id: 'capture-progress', style: 'width:0%' });
    this.viewfinder.append(progress);
    try {
      this.updateCamera();
      if (this.settings.focusMode !== 'MF') this.acquireFocus(true);
      const e = this.exact();
      const s = this.settings;
      const body = this.body;
      const lens = this.lens;
      const [W, H] = CAPTURE_SIZES[this.ui.quality];
      const pxPerMm = H / body.sensor.heightMm;
      const stabStops = totalStabilizationStops(s, body, lens);
      const omega = shakeAngularSpeed(s.support, stabStops);
      const seed = randomSeed();
      const shake = createShakeTrajectory(seed, omega);
      const t0 = this.worldTime;
      const basePosition = this.camera.position.clone();
      const pan = this.ui.trackAssist ? this.trackingRate(t0) ?? this.panRate() : this.panRate();
      const yaw0 = this.photographer.yaw;
      const pitch0 = this.photographer.pitch;
      const euler = new THREE.Euler(0, 0, 0, 'YXZ');
      const shakeQ = new THREE.Quaternion();
      const orientation = (ts: number, q: THREE.Quaternion) => {
        const sh = shake(ts);
        q.setFromEuler(euler.set(pitch0 + pan.pitch * ts, yaw0 + pan.yaw * ts, 0, 'YXZ'));
        return q.multiply(shakeQ.setFromEuler(euler.set(sh.pitch, sh.yaw, sh.roll, 'YXZ')));
      };

      blackout.classList.add('on');
      playShutter(e.shutter, this.ui.muted);

      // Measure what will happen during the exposure (for sample count and critique).
      const measured = this.measureExposure(t0, e.shutter, orientation, shake, pan, pxPerMm);
      const samples = temporalSampleCount(measured.maxBlurPx);
      const optics = this.optics();
      const sensor = this.sensorState(true);
      const result = await this.pipeline.capture(this.lab.scene, this.camera, (t) => this.lab.setTime(t), optics, sensor, this.eyeSensorState(), {
        width: W,
        height: H,
        shutterS: e.shutter,
        t0,
        samples,
        basePosition,
        orientation,
        seed,
        onProgress: (f) => {
          progress.style.width = `${f * 100}%`;
          if (f > 0.1) blackout.classList.remove('on');
        },
      });
      blackout.classList.remove('on');
      // The world kept moving while the shutter was open, and so did a panning camera.
      this.worldTime = t0 + e.shutter;
      this.photographer.yaw = yaw0 + pan.yaw * e.shutter;
      this.photographer.pitch = pitch0 + pan.pitch * e.shutter;

      const hist = computeHistogram(result.captured.data, 2);
      const dof = this.dof();
      const midSnr = snr(body.sensor, e.iso, Math.min(1, METERED_MIDTONE_SIGNAL * 2 ** this.meterStops()));
      const notes = critique({
        aperture: e.aperture,
        shutterS: e.shutter,
        iso: e.iso,
        focalMm: s.focalLengthMm,
        focusDistanceM: s.focusDistanceM,
        dofNearM: dof.nearM,
        dofFarM: dof.farM,
        meterOffsetStops: this.meterStops(),
        exposureCompensation: s.exposureCompensation,
        highlightClipFraction: hist.highlightClip,
        shadowClipFraction: hist.shadowClip,
        sharpPx: Math.max(1.5, circleOfConfusionMm(body.sensor) * pxPerMm),
        shakeBlurPx: measured.shakePx,
        stabilizationStops: stabStops,
        tripod: s.support === 'tripod',
        midtoneSnr: midSnr,
        focusTarget: this.afHit?.name,
        subjects: measured.subjects,
        pxPerMm,
        panning: measured.panning,
      });

      let assignment: Photo['assignment'];
      const active = assignments.find((a) => a.id === this.activeAssignment);
      if (active) {
        const measure: ShotMeasure = {
          frameHeightPx: H,
          sharpPx: Math.max(1.5, circleOfConfusionMm(body.sensor) * pxPerMm),
          subjects: measured.measures,
          highlightClip: hist.highlightClip,
          shadowClip: hist.shadowClip,
          meterOffset: this.meterStops(),
          exposureCompensation: s.exposureCompensation,
          shakePx: measured.shakePx,
          panBackgroundPx: measured.backgroundBlurPx,
          backgroundDefocusPx: blurDiscMm(s.focalLengthMm, e.aperture, s.focusDistanceM, Infinity) * pxPerMm,
          dofNearM: dof.nearM,
          dofFarM: dof.farM,
          midtoneSnr: midSnr,
        };
        const result = evaluateAssignment(active, measure);
        assignment = { id: active.id, title: active.title, ...result };
        if (result.passed && !this.completed.has(active.id)) {
          this.completed.add(active.id);
          saveCompleted(this.completed);
        }
      }
      const [url, seenUrl, thumbUrl] = await Promise.all([toJpegUrl(result.captured, 0.92), toJpegUrl(result.seen, 0.9), toJpegUrl(result.captured, 0.8, 240)]);
      const meta: PhotoMeta = {
        body: body.name,
        lens: lens.name,
        mode: `${s.mode}${s.autoIso ? ' + Auto ISO' : ''}`,
        focalMm: s.focalLengthMm,
        aperture: s.apertureNominal,
        shutterS: s.shutterNominal,
        iso: s.isoNominal,
        ec: s.exposureCompensation,
        focusDistanceM: s.focusDistanceM,
        focusMode: s.focusMode,
        focusTarget: this.afHit?.name,
        metering: s.metering,
        stabilization: s.support === 'tripod' ? 'n/a (tripod)' : stabStops > 0 ? `${stabStops} stops` : 'off',
        support: s.support,
        whiteBalance: 'Daylight (5500 K)',
        meterOffset: this.meterStops(),
        dofNearM: dof.nearM,
        dofFarM: dof.farM,
        samples,
        width: W,
        height: H,
        takenAt: new Date(),
        cameraHeightM: basePosition.y,
      };
      const photo: Photo = { id: ++this.photoId, url, seenUrl, thumbUrl, meta, notes, hist, assignment };
      this.gallery.add(photo);
      this.toast(photo);
    } catch (err) {
      console.error(err);
      this.hint = `Capture failed: ${(err as Error).message}`;
    } finally {
      progress.remove();
      blackout.classList.remove('on');
      this.capturing = false;
      if (shutterBtn) shutterBtn.disabled = false;
      this.lastFrame = performance.now();
      this.lab.setTime(this.worldTime);
    }
  }

  /**
   * Predict what happens during the exposure, using the same camera motion
   * the capture will use (panning + shake): image-plane movement of each
   * subject relative to the frame, shake blur, and background sweep.
   */
  private measureExposure(
    t0: number,
    T: number,
    orientation: (t: number, q: THREE.Quaternion) => THREE.Quaternion,
    shake: (t: number) => { yaw: number; pitch: number; roll: number },
    pan: { yaw: number; pitch: number },
    pxPerMm: number,
  ) {
    const steps = 24;
    const f = this.settings.focalLengthMm;
    const cam = this.camera.clone();
    const H = 24 * pxPerMm;
    const W = H * cam.aspect;
    const poseAt = (ts: number) => {
      orientation(ts, cam.quaternion);
      cam.updateMatrixWorld(true);
    };
    const project = (p: THREE.Vector3) => {
      const v = p.clone().project(cam);
      return new THREE.Vector2(v.x * 0.5 * W, v.y * 0.5 * H);
    };
    const af = new THREE.Vector2(this.settings.afPoint.x * 2 - 1, -(this.settings.afPoint.y * 2 - 1));
    const all: (SubjectFacts & { score: number })[] = [];
    const measures: SubjectMeasure[] = [];
    let maxBlurPx = 0;
    for (const subj of this.lab.subjects) {
      this.lab.setTime(t0);
      poseAt(0);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const p0 = subj.point(new THREE.Vector3());
      const ndc = p0.clone().project(cam);
      const dist = p0.clone().sub(cam.position).dot(forward);
      const sizePx = dist > 0 ? ((2 * subj.radius) / dist) * f * pxPerMm : 0;
      const inFrame = dist > 0 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && sizePx > 0.03 * H;
      let len = 0;
      let prev = project(p0);
      const d0 = p0.clone().sub(cam.position).normalize();
      let dEnd = d0;
      for (let i = 1; i <= steps; i++) {
        const ts = (T * i) / steps;
        this.lab.setTime(t0 + ts);
        poseAt(ts);
        const pt = subj.point(new THREE.Vector3());
        const cur = project(pt);
        len += cur.distanceTo(prev);
        prev = cur;
        dEnd = pt.clone().sub(cam.position).normalize();
      }
      const angularRate = (d0.angleTo(dEnd) / Math.max(T, 1e-6)) * (180 / Math.PI);
      const lateral = (d0.angleTo(dEnd) * Math.max(dist, 0.05)) / Math.max(T, 1e-6);
      const defocus = blurDiscMm(f, this.exact().aperture, this.settings.focusDistanceM, Math.max(dist, 0.05)) * pxPerMm;
      measures.push({
        name: subj.name,
        inFrame: dist > 0 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1,
        sizeFrac: sizePx / H,
        motionPx: len,
        defocusPx: defocus,
      });
      const score = inFrame ? ndc.clone().setZ(0).distanceTo(new THREE.Vector3(af.x, af.y, 0)) - Math.min(0.6, sizePx / H) : Infinity;
      all.push({
        name: subj.name,
        inFrame,
        distanceM: Math.max(dist, 0.05),
        lateralSpeedMps: Math.min(lateral, subj.speed(t0) * 1.2),
        motionBlurPx: len,
        defocusBlurPx: defocus,
        angularRateDegPerS: angularRate,
        score,
      });
      // Wheel rims, wings and limbs move up to ~2× the body speed.
      if (inFrame) maxBlurPx = Math.max(maxBlurPx, len * 2);
    }
    this.lab.setTime(t0);
    // Only discuss what the photograph is about: subjects near the AF point or large in frame.
    all.sort((a, b) => a.score - b.score);
    const subjects: SubjectFacts[] = all.map(({ score: _s, ...rest }, i) => ({ ...rest, inFrame: rest.inFrame && i < 3 }));
    let shakePx = 0;
    let prevS = shake(0);
    for (let i = 1; i <= steps * 2; i++) {
      const cur = shake((T * i) / (steps * 2));
      shakePx += Math.hypot(cur.yaw - prevS.yaw, cur.pitch - prevS.pitch) * f * pxPerMm;
      prevS = cur;
    }
    const panRateRad = Math.hypot(pan.yaw * Math.cos(this.photographer.pitch), pan.pitch);
    const backgroundBlurPx = panRateRad * T * f * pxPerMm;
    maxBlurPx = Math.max(maxBlurPx, shakePx, backgroundBlurPx);
    const panning =
      panRateRad > 0.02
        ? { rateDegPerS: (panRateRad * 180) / Math.PI, backgroundBlurPx, assisted: this.ui.trackAssist }
        : undefined;
    return { subjects, measures, shakePx, maxBlurPx, panning, backgroundBlurPx: panning ? backgroundBlurPx : 0 };
  }

  /* ---------------------------------------------------------------------- */
  /* Panning                                                                 */
  /* ---------------------------------------------------------------------- */

  private aimHistory: { t: number; yaw: number; pitch: number }[] = [];

  private recordAim(): void {
    const now = performance.now() / 1000;
    this.aimHistory.push({ t: now, yaw: this.photographer.yaw, pitch: this.photographer.pitch });
    while (this.aimHistory.length > 2 && now - this.aimHistory[0].t > 0.25) this.aimHistory.shift();
  }

  /** Angular velocity (rad/s) of the photographer's swing over the last ~0.15 s. */
  panRate(): { yaw: number; pitch: number } {
    const h = this.aimHistory;
    if (h.length < 2) return { yaw: 0, pitch: 0 };
    const last = h[h.length - 1];
    const first = h.find((e) => last.t - e.t <= 0.15) ?? h[0];
    const dt = last.t - first.t;
    if (dt < 0.03 || performance.now() / 1000 - last.t > 0.1) return { yaw: 0, pitch: 0 };
    return { yaw: (last.yaw - first.yaw) / dt, pitch: (last.pitch - first.pitch) / dt };
  }

  /** Rotation rate that keeps the subject under the AF point still in the frame. */
  private trackingRate(t0: number): { yaw: number; pitch: number } | null {
    const cam = this.camera;
    const af = new THREE.Vector2(this.settings.afPoint.x * 2 - 1, -(this.settings.afPoint.y * 2 - 1));
    let best: { subj: Subject; d: number } | null = null;
    this.lab.setTime(t0);
    for (const subj of this.lab.subjects) {
      if (subj.speed(t0) < 0.2) continue;
      const ndc = subj.point(new THREE.Vector3()).project(cam);
      if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
      const d = Math.hypot(ndc.x - af.x, ndc.y - af.y);
      if (d < 0.35 && (!best || d < best.d)) best = { subj, d };
    }
    if (!best) return null;
    const dt = 0.02;
    const dir = (t: number) => {
      this.lab.setTime(t);
      return best!.subj.point(new THREE.Vector3()).sub(cam.position);
    };
    const a = dir(t0);
    const b = dir(t0 + dt);
    this.lab.setTime(t0);
    const yawOf = (v: THREE.Vector3) => Math.atan2(-v.x, -v.z);
    const pitchOf = (v: THREE.Vector3) => Math.atan2(v.y, Math.hypot(v.x, v.z));
    let dy = yawOf(b) - yawOf(a);
    if (dy > Math.PI) dy -= 2 * Math.PI;
    if (dy < -Math.PI) dy += 2 * Math.PI;
    return { yaw: dy / dt, pitch: (pitchOf(b) - pitchOf(a)) / dt };
  }

  private toastTimer = 0;
  private toast(p: Photo): void {
    const t = document.getElementById('toast')!;
    const first = p.assignment
      ? {
          text: p.assignment.passed
            ? `✓ Assignment complete: ${p.assignment.title}`
            : `✗ ${p.assignment.title}: ${p.assignment.results.find((r) => !r.passed)?.text ?? ''}`,
        }
      : (p.notes.find((n) => n.level === 'warn') ?? p.notes[0]);
    t.innerHTML = '';
    const open = el('button', { class: 'btn small', text: 'Review (R)' });
    open.addEventListener('click', () => {
      t.classList.add('hidden');
      this.gallery.open(this.gallery.photos.length - 1);
    });
    t.append(el('img', { src: p.thumbUrl, alt: '' }), el('p', { text: first ? first.text : 'Photo captured.' }), open);
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.add('hidden'), 7000);
  }

  /* ---------------------------------------------------------------------- */
  /* UI                                                                      */
  /* ---------------------------------------------------------------------- */

  private buildPanel(): void {
    const p = this.panel;
    p.heading('Exposure Lab', 'One full-frame body · M / A / S / P · a sunny park');

    const shutterBtn = el('button', { class: 'shutter', id: 'shutter-btn', text: 'SHUTTER', title: 'Space / Enter' });
    shutterBtn.addEventListener('click', () => void this.shoot());
    p.root.append(shutterBtn, el('div', { class: 'kbd', style: 'text-align:center;margin-bottom:6px', text: 'Space to shoot · R to review' }));

    const exp = p.group('Exposure');
    p.segmented<ExposureMode>(
      exp,
      'Mode',
      [
        { value: 'M', label: 'M', title: 'Manual: you set aperture, shutter and ISO' },
        { value: 'A', label: 'A', title: 'Aperture priority: you set the aperture, the camera picks the shutter' },
        { value: 'S', label: 'S', title: 'Shutter priority: you set the shutter, the camera picks the aperture' },
        { value: 'P', label: 'P', title: 'Program: the camera picks aperture and shutter' },
      ],
      () => this.settings.mode,
      (v) => this.change({ mode: v }),
    );
    p.stepper(exp, 'Aperture', () => formatAperture(this.settings.apertureNominal), (d) => this.step('aperture', d), 'Keys 1 / 2');
    p.stepper(exp, 'Shutter', () => formatShutter(this.settings.shutterNominal), (d) => this.step('shutter', d), 'Keys 3 / 4');
    p.stepper(exp, 'ISO', () => `${this.settings.autoIso ? 'A ' : ''}${this.settings.isoNominal}`, (d) => this.step('iso', d), 'Keys 5 / 6');
    p.checks(exp, [
      { label: 'Auto ISO (O)', get: () => this.settings.autoIso, set: (v) => this.change({ autoIso: v }), title: 'Raises ISO to keep the shutter at 1/focal length or faster' },
    ]);
    p.select(
      exp,
      'Max ISO',
      [1600, 3200, 6400, 12800, 25600].map((v) => ({ value: String(v), label: String(v) })),
      () => String(this.settings.autoIsoMax),
      (v) => this.change({ autoIsoMax: Number(v) }),
    );
    p.stepper(exp, 'Exp. comp', () => `${this.settings.exposureCompensation > 0 ? '+' : ''}${this.settings.exposureCompensation.toFixed(1)}`, (d) => this.step('ec', d), 'Shifts the meter target');
    p.segmented<MeteringMode>(
      exp,
      'Metering',
      [
        { value: 'evaluative', label: 'Evaluative' },
        { value: 'center', label: 'Center' },
        { value: 'spot', label: 'Spot', title: 'Spot meter follows the AF point' },
      ],
      () => this.settings.metering,
      (v) => this.change({ metering: v }),
    );
    p.readout(exp, () => {
      const m = this.meterStops();
      const e = this.exact();
      const sn = snr(this.body.sensor, e.iso, METERED_MIDTONE_SIGNAL);
      const lim = this.aeLimited ? `<br><b style="color:#ff8a6a">${this.aeLimited === 'too-bright' ? 'Too bright: the camera has run out of range (try a lower ISO, smaller aperture or faster shutter)' : 'Too dark: the camera has run out of range (try a higher ISO, wider aperture or slower shutter)'}</b>` : '';
      return `${lim ? lim.slice(4) + '<br>' : ''}Meter: <b>${m >= 0 ? '+' : ''}${m.toFixed(1)} EV</b> ${Math.abs(m) < 0.35 ? '(balanced)' : m > 0 ? '(brighter than meter)' : '(darker than meter)'}<br>Scene ≈ EV ${meteredEv100(this.meteredLuminance).toFixed(1)} · ${Math.round(this.meteredLuminance)} cd/m²<br>Mid-tone SNR at this ISO ≈ ${sn.toFixed(0)}:1`;
    });
    p.buttons(exp, [
      {
        label: 'Match meter (shutter)',
        title: 'Set the shutter speed the meter recommends',
        onClick: () => {
          const ev = meteredEv100(this.meteredLuminance) + this.settings.exposureCompensation;
          const e = this.exact();
          const t = (e.aperture * e.aperture) / 2 ** (ev + Math.log2(e.iso / 100));
          this.change({ shutterNominal: t });
        },
      },
    ]);

    const lensG = p.group('Lens');
    p.select(lensG, 'Lens', lenses.map((l) => ({ value: l.id, label: l.name })), () => this.settings.lensId, (v) => this.change({ lensId: v }));
    p.slider(
      lensG,
      'Zoom',
      0,
      1000,
      1,
      () => {
        const [a, b] = this.lens.focalRange;
        return b > a ? (Math.log(this.settings.focalLengthMm / a) / Math.log(b / a)) * 1000 : 0;
      },
      (v) => {
        const [a, b] = this.lens.focalRange;
        this.change({ focalLengthMm: Math.round(a * (b / a) ** (v / 1000)) });
      },
      () => isZoom(this.lens),
      () => `${Math.round(this.settings.focalLengthMm)} mm`,
    );

    const focus = p.group('Focus');
    p.segmented<FocusMode>(
      focus,
      'Mode',
      [
        { value: 'AF-S', label: 'AF-S', title: 'Single AF: focuses when you click or press the shutter' },
        { value: 'AF-C', label: 'AF-C', title: 'Continuous AF: keeps focusing on whatever is under the AF point' },
        { value: 'MF', label: 'MF', title: 'Manual focus: use the slider or mouse wheel' },
      ],
      () => this.settings.focusMode,
      (v) => {
        this.change({ focusMode: v });
        if (v !== 'MF') this.acquireFocus();
      },
    );
    p.slider(
      focus,
      'Distance',
      0,
      1000,
      1,
      () => this.focusToSlider(this.settings.focusDistanceM),
      (v) => this.change({ focusDistanceM: this.sliderToFocus(v), focusMode: 'MF' }),
      () => true,
      () => formatDistance(this.settings.focusDistanceM >= INFINITY_M * 0.99 ? Infinity : this.settings.focusDistanceM),
    );
    p.readout(focus, () => {
      const d = this.dof();
      return `Depth of field: ${formatDistance(d.nearM)} – ${formatDistance(d.farM)}<br>Total: ${Number.isFinite(d.totalM) ? formatDistance(d.totalM) : '∞'} · hyperfocal ${formatDistance(d.hyperfocalM)}<br>Min. focus ${formatDistance(this.lens.minimumFocusDistanceM)}`;
    });
    p.buttons(focus, [
      { label: 'Focus at hyperfocal', title: 'Everything from half this distance to infinity is acceptably sharp', onClick: () => this.change({ focusMode: 'MF', focusDistanceM: this.dof().hyperfocalM }) },
      { label: 'Center AF point', onClick: () => this.change({ afPoint: { x: 0.5, y: 0.5 } }) },
    ]);

    const stab = p.group('Support');
    p.segmented(
      stab,
      'Support',
      [
        { value: 'handheld', label: 'Hand-held' },
        { value: 'tripod', label: 'Tripod' },
      ],
      () => this.settings.support,
      (v) => this.change({ support: v as 'handheld' | 'tripod' }),
    );
    p.checks(stab, [
      { label: 'Stabilisation', get: () => this.settings.stabilization, set: (v) => this.change({ stabilization: v }), title: 'Body IBIS + lens OIS. Steadies the camera, not the subject.' },
      { label: 'Crouch (C)', get: () => this.photographer.crouching, set: (v) => (this.photographer.crouching = v) },
      {
        label: 'Tracking assist',
        get: () => this.ui.trackAssist,
        set: (v) => (this.ui.trackAssist = v),
        title: 'Panning aid: during the exposure the camera swings exactly with the moving subject under the AF point',
      },
    ]);
    stab.append(el('p', { class: 'help', style: 'margin:4px 0 0', text: 'Panning: drag the view to follow a moving subject and press Space while still moving. The camera keeps swinging during the exposure.' }));

    const asg = p.group('Assignments');
    p.select(
      asg,
      'Goal',
      [{ value: '', label: 'Sandbox (free shooting)' }, ...assignments.map((a) => ({ value: a.id, label: a.title }))],
      () => this.activeAssignment,
      (v) => this.selectAssignment(v),
    );
    p.readout(asg, () => {
      const a = assignments.find((x) => x.id === this.activeAssignment);
      const done = `${this.completed.size} / ${assignments.length} completed`;
      if (!a) return `Shoot anything — no scoring.<br>${done}`;
      return `${this.completed.has(a.id) ? '✓ ' : ''}<b>${a.title}</b><br>${a.brief}${this.showHint && a.hint ? `<br><i>Hint: ${a.hint}</i>` : ''}<br>${done}`;
    });
    p.buttons(asg, [
      {
        label: 'Go to start',
        title: 'Walk to a good starting position (settings are up to you)',
        onClick: () => {
          const a = assignments.find((x) => x.id === this.activeAssignment);
          if (!a?.setup) return;
          this.photographer.place(a.setup.x, a.setup.z);
          this.photographer.lookAt(a.setup.lookAt);
          if (a.setup.lensId) this.change({ lensId: a.setup.lensId });
        },
      },
      { label: 'Hint', onClick: () => ((this.showHint = !this.showHint), this.panel.refresh()) },
    ]);

    const persp = p.group('Perspective lesson');
    persp.append(el('p', { class: 'help', style: 'margin:0 0 6px', text: 'Frame the portrait the same size with different lenses. The subject stays the same; watch the background.' }));
    p.buttons(persp, [
      { label: '24mm close', onClick: () => this.perspectiveStation('24-f2.8', 24) },
      { label: '50mm', onClick: () => this.perspectiveStation('50-f1.8', 50) },
      { label: '85mm', onClick: () => this.perspectiveStation('85-f1.4', 85) },
      { label: '200mm far', onClick: () => this.perspectiveStation('70-200-f2.8', 200) },
      {
        label: 'Start position',
        onClick: () => {
          this.photographer.place(0.6, 10.2);
          this.photographer.lookAt(new THREE.Vector3(0, 1.25, 2));
          this.change({ lensId: '50-f1.8', afPoint: { x: 0.5, y: 0.45 } });
          this.acquireFocus();
        },
      },
    ]);

    const panG = p.group('Panning lesson');
    panG.append(el('p', { class: 'help', style: 'margin:0 0 6px', text: 'Goal: a sharp cyclist against a streaked background. Try 1/30 s at f/11, follow the rider, and shoot mid-swing.' }));
    p.buttons(panG, [
      {
        label: 'Go to the path',
        onClick: () => {
          this.photographer.place(1.5, -0.2);
          this.photographer.lookAt({ x: 1.5, y: 1.0, z: -4.5 });
          this.change({ mode: 'S', shutterNominal: 1 / 30, autoIso: true, lensId: '50-f1.8', focusMode: 'AF-C', afPoint: { x: 0.5, y: 0.5 } });
          this.hint = 'Wait for the cyclist, drag to follow, press Space while swinging';
        },
      },
    ]);

    const view = p.group('Viewfinder aids');
    p.checks(view, [
      { label: 'Grid (G)', get: () => this.ui.grid, set: (v) => (this.ui.grid = v) },
      { label: 'Histogram (H)', get: () => this.ui.histogram, set: (v) => (this.ui.histogram = v) },
      { label: 'Zebras (Z)', get: () => this.ui.zebra, set: (v) => (this.ui.zebra = v), title: 'Stripes where the sensor will clip' },
      { label: 'Peaking (P)', get: () => this.ui.peaking, set: (v) => (this.ui.peaking = v), title: 'Red edges where focus is sharp' },
      { label: 'DOF zone (V)', get: () => this.ui.dofZone, set: (v) => (this.ui.dofZone = v), title: 'Tints everything inside the depth of field' },
      { label: 'Noise preview', get: () => this.ui.noisePreview, set: (v) => (this.ui.noisePreview = v) },
    ]);

    const sim = p.group('Simulation');
    p.checks(sim, [
      { label: 'Freeze world (F)', get: () => this.ui.freeze, set: (v) => (this.ui.freeze = v), title: 'Pause the world while you compose. A photo still records the motion happening at that instant.' },
      { label: 'Stats (`)', get: () => this.ui.stats, set: (v) => (this.ui.stats = v) },
      { label: 'Mute', get: () => this.ui.muted, set: (v) => (this.ui.muted = v) },
    ]);
    p.select(
      sim,
      'Quality',
      [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'ultra', label: 'Ultra' },
      ],
      () => this.ui.quality,
      (v) => this.setQuality(v as Quality),
    );

    const help = p.group('Controls');
    help.append(
      el('div', {
        class: 'help',
        html: `<kbd>W A S D</kbd> walk (<kbd>Shift</kbd> faster) · drag view to look · click to place AF point & focus<br>
        <kbd>1</kbd>/<kbd>2</kbd> aperture · <kbd>3</kbd>/<kbd>4</kbd> shutter · <kbd>5</kbd>/<kbd>6</kbd> ISO · <kbd>7</kbd>/<kbd>8</kbd> exp. comp<br>
        <kbd>Q</kbd>/<kbd>E</kbd> change lens · wheel: zoom (or focus in MF) · <kbd>M</kbd> cycle focus mode<br>
        <kbd>C</kbd> crouch · <kbd>T</kbd> tripod · <kbd>I</kbd> stabilisation · <kbd>Space</kbd> shoot · <kbd>R</kbd> review`,
      }),
    );
  }

  private focusToSlider(d: number): number {
    const mfd = this.lens.minimumFocusDistanceM;
    if (d >= INFINITY_M * 0.99) return 1000;
    return Math.min(999, (Math.log(d / mfd) / Math.log(200 / mfd)) * 999);
  }

  private sliderToFocus(v: number): number {
    const mfd = this.lens.minimumFocusDistanceM;
    if (v >= 1000) return INFINITY_M;
    return mfd * (200 / mfd) ** (v / 999);
  }

  private setQuality(q: Quality): void {
    if (q === this.ui.quality) return;
    this.ui.quality = q;
    this.pipeline.dofBudget = DOF_BUDGET[q];
    // Rebuild the world at the new detail level.
    this.lab.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    this.lab = buildExposureLab(this.renderer, q);
    this.resize();
  }

  private bindInput(): void {
    const vf = this.viewfinder;
    let down: { x: number; y: number; t: number; id: number; moved: boolean } | null = null;
    vf.addEventListener('pointerdown', (e) => {
      vf.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false };
    });
    vf.addEventListener('pointermove', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 4) return;
      down.moved = true;
      down.x = e.clientX;
      down.y = e.clientY;
      const rect = vf.getBoundingClientRect();
      this.photographer.look(dx, dy, THREE.MathUtils.degToRad(this.camera.fov), rect.height);
      this.hint = null;
    });
    vf.addEventListener('pointerup', (e) => {
      if (!down || down.id !== e.pointerId) return;
      const wasClick = !down.moved;
      down = null;
      if (!wasClick) return;
      const rect = vf.getBoundingClientRect();
      const x = THREE.MathUtils.clamp((e.clientX - rect.left) / rect.width, 0.03, 0.97);
      const y = THREE.MathUtils.clamp((e.clientY - rect.top) / rect.height, 0.03, 0.97);
      this.change({ afPoint: { x, y } });
      this.acquireFocus(false);
      this.hint = null;
    });
    vf.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const dir = Math.sign(e.deltaY);
        if (this.settings.focusMode === 'MF') {
          this.change({ focusDistanceM: this.sliderToFocus(this.focusToSlider(this.settings.focusDistanceM) - dir * 12) });
        } else if (isZoom(this.lens)) {
          const [a, b] = this.lens.focalRange;
          this.change({ focalLengthMm: Math.round(Math.min(b, Math.max(a, this.settings.focalLengthMm * (dir > 0 ? 0.95 : 1.05)))) });
        }
      },
      { passive: false },
    );

    window.addEventListener('keydown', (e) => {
      if (this.gallery.handleKey(e)) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      this.photographer.setKey(e.code, true);
      if (e.repeat && !['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].includes(e.code)) return;
      const handled = this.handleKey(e.code);
      if (handled) e.preventDefault();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) this.hint = null;
    });
    window.addEventListener('keyup', (e) => this.photographer.setKey(e.code, false));
    window.addEventListener('blur', () => this.photographer.clearKeys());
  }

  private handleKey(code: string): boolean {
    switch (code) {
      case 'Space':
      case 'Enter':
        void this.shoot();
        return true;
      case 'Digit1':
        this.step('aperture', -1);
        return true;
      case 'Digit2':
        this.step('aperture', 1);
        return true;
      case 'Digit3':
        this.step('shutter', -1);
        return true;
      case 'Digit4':
        this.step('shutter', 1);
        return true;
      case 'Digit5':
        this.step('iso', -1);
        return true;
      case 'Digit6':
        this.step('iso', 1);
        return true;
      case 'Digit7':
        this.step('ec', -1);
        return true;
      case 'Digit8':
        this.step('ec', 1);
        return true;
      case 'KeyQ':
        this.cycleLens(-1);
        return true;
      case 'KeyE':
        this.cycleLens(1);
        return true;
      case 'KeyM': {
        const order: FocusMode[] = ['AF-S', 'AF-C', 'MF'];
        const next = order[(order.indexOf(this.settings.focusMode) + 1) % order.length];
        this.change({ focusMode: next });
        if (next !== 'MF') this.acquireFocus();
        return true;
      }
      case 'KeyC':
        this.photographer.crouching = !this.photographer.crouching;
        this.panel.refresh();
        return true;
      case 'KeyT':
        this.change({ support: this.settings.support === 'tripod' ? 'handheld' : 'tripod' });
        return true;
      case 'KeyX': {
        const order: ExposureMode[] = ['M', 'A', 'S', 'P'];
        this.change({ mode: order[(order.indexOf(this.settings.mode) + 1) % order.length] });
        return true;
      }
      case 'KeyO':
        this.change({ autoIso: !this.settings.autoIso });
        return true;
      case 'KeyI':
        this.change({ stabilization: !this.settings.stabilization });
        return true;
      case 'KeyG':
        this.ui.grid = !this.ui.grid;
        break;
      case 'KeyH':
        this.ui.histogram = !this.ui.histogram;
        break;
      case 'KeyZ':
        this.ui.zebra = !this.ui.zebra;
        break;
      case 'KeyP':
        this.ui.peaking = !this.ui.peaking;
        break;
      case 'KeyV':
        this.ui.dofZone = !this.ui.dofZone;
        break;
      case 'KeyF':
        this.ui.freeze = !this.ui.freeze;
        break;
      case 'Backquote':
        this.ui.stats = !this.ui.stats;
        break;
      case 'KeyR':
        if (this.gallery.photos.length) this.gallery.open(this.gallery.photos.length - 1);
        return true;
      default:
        return false;
    }
    this.panel.refresh();
    return true;
  }
}

async function toJpegUrl(img: ImageData, quality: number, maxWidth?: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  let src: HTMLCanvasElement = c;
  if (maxWidth && img.width > maxWidth) {
    const s = document.createElement('canvas');
    s.width = maxWidth;
    s.height = Math.round((img.height * maxWidth) / img.width);
    const ctx = s.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, s.width, s.height);
    src = s;
  }
  const blob = await new Promise<Blob>((res, rej) => src.toBlob((b) => (b ? res(b) : rej(new Error('JPEG encode failed'))), 'image/jpeg', quality));
  return URL.createObjectURL(blob);
}
