/**
 * PhotoPipeline turns a 3D world plus a physical camera description into
 * either a live electronic-viewfinder image or a captured photograph.
 *
 *   scene (absolute luminance, HDR) ─┐
 *   depth ──────────────────────────┴─► CoC ─► DOF gather ─┬─► develop ─► EVF canvas
 *                                                          └─► (capture) temporal
 *                                                              accumulation over the
 *                                                              shutter interval ─► develop ─► JPEG
 *
 * Nothing here knows about UI. Camera maths comes from src/sim.
 */

import * as THREE from 'three';
import { COC_FRAG, COPY_FRAG, DEVELOP_FRAG, DOF_FRAG, FULLSCREEN_VERT, METER_FRAG } from './shaders/passes';
import { LUMINANCE_UNIT } from './units';
import { mulberry32 } from '../sim/random';

export interface OpticalState {
  focalMm: number;
  aperture: number;
  focusDistanceM: number;
  sensorWidthMm: number;
  sensorHeightMm: number;
  /** Thin-lens blur coefficient k (mm): diameter = k·|z − s|/z. */
  blurCoefficientMm: number;
  /** Acceptable circle of confusion (mm). */
  cocLimitMm: number;
}

export interface SensorState {
  /** Multiplier from scene luminance (cd/m²) to normalised raw. */
  exposureScale: number;
  vignetteStops: number;
  fullScaleElectrons: number;
  readNoiseElectrons: number;
  noise: boolean;
  whiteBalance: [number, number, number];
}

export interface Overlays {
  zebra: boolean;
  peaking: boolean;
  dofZone: boolean;
}

export interface CaptureSpec {
  width: number;
  height: number;
  shutterS: number;
  /** World time when the shutter opens. */
  t0: number;
  samples: number;
  /** Camera position during the exposure (the photographer stands still). */
  basePosition: THREE.Vector3;
  /**
   * Camera orientation at time `t` since the shutter opened: the aim at the
   * press, plus any panning rotation, plus hand shake.
   */
  orientation: (t: number, target: THREE.Quaternion) => THREE.Quaternion;
  seed: number;
  onProgress?: (fraction: number) => void;
}

export interface CaptureResult {
  captured: ImageData;
  seen: ImageData;
}

interface Targets {
  scene: THREE.WebGLRenderTarget;
  coc: THREE.WebGLRenderTarget;
  dof: THREE.WebGLRenderTarget;
}

function hdrTarget(w: number, h: number, type: THREE.TextureDataType, samples = 0, depth = false): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: depth,
    samples,
  });
  if (depth) {
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  }
  rt.texture.generateMipmaps = false;
  return rt;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class PhotoPipeline {
  readonly renderer: THREE.WebGLRenderer;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly cocMat: THREE.ShaderMaterial;
  private readonly dofMat: THREE.ShaderMaterial;
  private readonly copyMat: THREE.ShaderMaterial;
  private readonly meterMat: THREE.ShaderMaterial;
  private readonly developMat: THREE.ShaderMaterial;
  private live?: Targets & { w: number; h: number; msaa: number };
  private readonly meterRT: THREE.WebGLRenderTarget;
  private readonly meterBuf: Float32Array;
  private readonly histRT: THREE.WebGLRenderTarget;
  private readonly histBuf: Uint8Array;
  private readonly accumType: THREE.TextureDataType;
  /** Samples budget per pixel for the DOF gather (quality setting). */
  dofBudget = 220;
  msaa = 4;
  frame = 0;

  static readonly METER_W = 48;
  static readonly METER_H = 32;
  static readonly HIST_W = 120;
  static readonly HIST_H = 80;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    if (!renderer.extensions.has('EXT_color_buffer_float')) {
      throw new Error('This browser/GPU cannot render to floating-point targets (EXT_color_buffer_float).');
    }
    this.accumType = renderer.extensions.has('EXT_float_blend') ? THREE.FloatType : THREE.HalfFloatType;
    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.cocMat = mk(COC_FRAG, {
      tColor: { value: null },
      tDepth: { value: null },
      uNear: { value: 0.05 },
      uFar: { value: 3000 },
      uFocus: { value: 3 },
      uCocK: { value: 0 },
      uMaxCoc: { value: 32 },
      uClamp: { value: 400 },
    });
    this.dofMat = mk(DOF_FRAG, {
      tCoc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uMaxRadius: { value: 0 },
      uRadScale: { value: 1 },
      uFrame: { value: 0 },
    });
    this.copyMat = mk(COPY_FRAG, { tInput: { value: null }, uWeight: { value: 1 } });
    this.meterMat = mk(METER_FRAG, { tInput: { value: null }, uCell: { value: new THREE.Vector2() } });
    this.developMat = mk(DEVELOP_FRAG, {
      tInput: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uAspect: { value: 1.5 },
      uExposure: { value: 1 },
      uVignette: { value: 0 },
      uFullScale: { value: 50000 },
      uReadNoise: { value: 3 },
      uNoise: { value: 1 },
      uSeed: { value: 0 },
      uWB: { value: new THREE.Vector3(1, 1, 1) },
      uZebra: { value: 0 },
      uPeaking: { value: 0 },
      uDofZone: { value: 0 },
      uCocLimitPx: { value: 1 },
      uTime: { value: 0 },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const W = PhotoPipeline.METER_W;
    const H = PhotoPipeline.METER_H;
    this.meterRT = hdrTarget(W, H, THREE.FloatType);
    this.meterBuf = new Float32Array(W * H * 4);
    this.histRT = new THREE.WebGLRenderTarget(PhotoPipeline.HIST_W, PhotoPipeline.HIST_H, { depthBuffer: false });
    this.histBuf = new Uint8Array(PhotoPipeline.HIST_W * PhotoPipeline.HIST_H * 4);
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, blend = false): void {
    // Accumulation must be a plain sum: alpha carries the signed CoC, not coverage.
    material.blending = blend ? THREE.CustomBlending : THREE.NoBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.transparent = blend;
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  private ensureLive(w: number, h: number): Targets {
    if (!this.live || this.live.w !== w || this.live.h !== h || this.live.msaa !== this.msaa) {
      if (this.live) this.disposeTargets(this.live);
      this.live = { ...this.createTargets(w, h, this.msaa), w, h, msaa: this.msaa };
    }
    return this.live;
  }

  private createTargets(w: number, h: number, msaa: number): Targets {
    return {
      scene: hdrTarget(w, h, THREE.HalfFloatType, msaa, true),
      coc: hdrTarget(w, h, THREE.HalfFloatType),
      dof: hdrTarget(w, h, THREE.HalfFloatType),
    };
  }

  private disposeTargets(t: Targets): void {
    t.scene.depthTexture?.dispose();
    t.scene.dispose();
    t.coc.dispose();
    t.dof.dispose();
  }

  /** Render scene → CoC → DOF into `t.dof`. */
  private renderOptics(scene: THREE.Scene, camera: THREE.PerspectiveCamera, optics: OpticalState, t: Targets, w: number, h: number, frameSeed: number, dof = true): void {
    const r = this.renderer;
    r.setRenderTarget(t.scene);
    r.clear();
    r.render(scene, camera);

    const pxPerMm = h / optics.sensorHeightMm;
    const cocK = dof ? optics.blurCoefficientMm * pxPerMm : 0;
    // Largest blur radius worth gathering: background at infinity or a foreground object ~0.4 m away.
    const nearZ = 0.4;
    const radiusInf = 0.5 * cocK;
    const radiusNear = 0.5 * cocK * Math.abs(nearZ - optics.focusDistanceM) / nearZ;
    const hardCap = 0.045 * h;
    const maxRadius = Math.min(hardCap, Math.max(radiusInf, Math.min(radiusNear, hardCap)));

    const cu = this.cocMat.uniforms;
    cu.tColor.value = t.scene.texture;
    cu.tDepth.value = t.scene.depthTexture;
    cu.uNear.value = camera.near;
    cu.uFar.value = camera.far;
    cu.uFocus.value = optics.focusDistanceM;
    cu.uCocK.value = cocK;
    cu.uMaxCoc.value = maxRadius;
    this.pass(this.cocMat, t.coc);

    const du = this.dofMat.uniforms;
    du.tCoc.value = t.coc.texture;
    du.uTexel.value.set(1 / w, 1 / h);
    du.uMaxRadius.value = maxRadius > 0.75 ? maxRadius : 0;
    du.uRadScale.value = Math.max(0.5, (maxRadius * maxRadius) / (2 * this.dofBudget));
    du.uFrame.value = frameSeed;
    this.pass(this.dofMat, t.dof);
  }

  private setDevelop(input: THREE.Texture, w: number, h: number, sensor: SensorState, optics: OpticalState, overlays: Overlays | null, seed: number): void {
    const u = this.developMat.uniforms;
    u.tInput.value = input;
    u.uTexel.value.set(1 / w, 1 / h);
    u.uAspect.value = w / h;
    u.uExposure.value = sensor.exposureScale * LUMINANCE_UNIT;
    u.uVignette.value = sensor.vignetteStops;
    u.uFullScale.value = sensor.fullScaleElectrons;
    u.uReadNoise.value = sensor.readNoiseElectrons;
    u.uNoise.value = sensor.noise ? 1 : 0;
    u.uSeed.value = seed % 1000;
    u.uWB.value.set(...sensor.whiteBalance);
    u.uZebra.value = overlays?.zebra ? 1 : 0;
    u.uPeaking.value = overlays?.peaking ? 1 : 0;
    u.uDofZone.value = overlays?.dofZone ? 1 : 0;
    u.uCocLimitPx.value = 0.5 * optics.cocLimitMm * (h / optics.sensorHeightMm);
    u.uTime.value = performance.now() / 1000;
  }

  /** Live EVF render into the canvas (default framebuffer) at w×h. */
  renderLive(scene: THREE.Scene, camera: THREE.PerspectiveCamera, optics: OpticalState, sensor: SensorState, overlays: Overlays, w: number, h: number): void {
    this.frame++;
    const t = this.ensureLive(w, h);
    this.renderOptics(scene, camera, optics, t, w, h, 0);
    this.setDevelop(t.dof.texture, w, h, sensor, optics, overlays, this.frame);
    this.renderer.setViewport(0, 0, w, h);
    this.pass(this.developMat, null);
  }

  /**
   * Average scene luminance grid (cd/m²) of the last live frame.
   * Returns METER_W × METER_H values, row 0 = bottom.
   */
  readMeter(): { mean: Float32Array; max: Float32Array } {
    if (!this.live) return { mean: new Float32Array(0), max: new Float32Array(0) };
    const u = this.meterMat.uniforms;
    u.tInput.value = this.live.scene.texture;
    u.uCell.value.set(1 / PhotoPipeline.METER_W, 1 / PhotoPipeline.METER_H);
    this.pass(this.meterMat, this.meterRT);
    this.renderer.readRenderTargetPixels(this.meterRT, 0, 0, PhotoPipeline.METER_W, PhotoPipeline.METER_H, this.meterBuf);
    const n = PhotoPipeline.METER_W * PhotoPipeline.METER_H;
    const mean = new Float32Array(n);
    const max = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mean[i] = this.meterBuf[i * 4] * LUMINANCE_UNIT;
      max[i] = this.meterBuf[i * 4 + 1] * LUMINANCE_UNIT;
    }
    return { mean, max };
  }

  /** Small developed copy of the last live frame for the live histogram (RGBA8, row 0 = bottom). */
  readLiveHistogramImage(sensor: SensorState, optics: OpticalState): Uint8Array {
    if (!this.live) return this.histBuf;
    this.setDevelop(this.live.dof.texture, this.live.w, this.live.h, sensor, optics, null, this.frame);
    this.pass(this.developMat, this.histRT);
    this.renderer.readRenderTargetPixels(this.histRT, 0, 0, PhotoPipeline.HIST_W, PhotoPipeline.HIST_H, this.histBuf);
    return this.histBuf;
  }

  /**
   * Capture a photograph: integrate `samples` renders spread across the
   * shutter interval (world animation + panning + camera shake + sub-pixel jitter),
   * then run the sensor/develop stage once on the integrated light.
   */
  async capture(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    setTime: (t: number) => void,
    optics: OpticalState,
    sensor: SensorState,
    seenSensor: SensorState,
    spec: CaptureSpec,
  ): Promise<CaptureResult> {
    const { width: w, height: h } = spec;
    const targets = this.createTargets(w, h, 0);
    const accum = hdrTarget(w, h, this.accumType);
    const out = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    const rand = mulberry32(spec.seed);
    const readImage = () => {
      const buf = new Uint8ClampedArray(w * h * 4);
      r.readRenderTargetPixels(out, 0, 0, w, h, buf);
      // Flip rows: GL origin is bottom-left.
      const img = new ImageData(w, h);
      const row = w * 4;
      for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      return img;
    };

    try {
      // "What you saw": a single instant, eye-adapted, no noise, everything sharp.
      setTime(spec.t0);
      camera.position.copy(spec.basePosition);
      spec.orientation(0, camera.quaternion);
      camera.updateMatrixWorld(true);
      this.renderOptics(scene, camera, optics, targets, w, h, 0, false);
      this.setDevelop(targets.dof.texture, w, h, seenSensor, optics, null, 1);
      this.pass(this.developMat, out);
      const seen = readImage();

      r.setRenderTarget(accum);
      r.setClearColor(0x000000, 0);
      r.clear();
      const n = spec.samples;
      for (let i = 0; i < n; i++) {
        // Stratified sample times across the open shutter.
        const u = (i + rand()) / n;
        const ts = u * spec.shutterS;
        setTime(spec.t0 + ts);
        camera.position.copy(spec.basePosition);
        spec.orientation(ts, camera.quaternion);
        camera.updateMatrixWorld(true);
        // Sub-pixel jitter for anti-aliasing.
        camera.updateProjectionMatrix();
        camera.projectionMatrix.elements[8] += ((rand() - 0.5) * 2) / w;
        camera.projectionMatrix.elements[9] += ((rand() - 0.5) * 2) / h;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

        this.renderOptics(scene, camera, optics, targets, w, h, i + 1);
        this.copyMat.uniforms.tInput.value = targets.dof.texture;
        this.copyMat.uniforms.uWeight.value = 1 / n;
        r.autoClear = false;
        this.pass(this.copyMat, accum, true);
        r.autoClear = prevAutoClear;
        if (i % 4 === 3) {
          spec.onProgress?.((i + 1) / n);
          await nextFrame();
        }
      }
      camera.updateProjectionMatrix();
      this.setDevelop(accum.texture, w, h, sensor, optics, null, spec.seed);
      this.pass(this.developMat, out);
      const captured = readImage();
      return { captured, seen };
    } finally {
      r.autoClear = prevAutoClear;
      r.setRenderTarget(null);
      this.disposeTargets(targets);
      accum.dispose();
      out.dispose();
      this.copyMat.blending = THREE.NoBlending;
    }
  }

  dispose(): void {
    if (this.live) this.disposeTargets(this.live);
    this.meterRT.dispose();
    this.histRT.dispose();
  }
}
