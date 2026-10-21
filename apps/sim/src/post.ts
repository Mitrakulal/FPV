import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const EXTRACT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform float uThreshold;

  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float l = max(max(c.r, c.g), c.b);
    float w = smoothstep(uThreshold, uThreshold + 1.5, l);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uDir;

  void main() {
    vec3 sum = texture2D(tSrc, vUv).rgb * 0.227027;
    sum += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
    sum += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const FINAL = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform vec2 uResolution;
  uniform vec2 uBlurDir;
  uniform float uTime;
  uniform float uExposure;
  uniform float uBloom;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uAberration;
  uniform float uDistortion;
  uniform float uAnalog;
  uniform float uBlur;
  uniform float uFlash;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  void main() {
    vec2 cc = vUv - 0.5;
    float r2 = dot(cc, cc);
    vec2 uv = 0.5 + cc * (1.0 + uDistortion * r2);

    // light motion smear along the camera's angular velocity
    vec3 col = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float t = float(i) - 1.0;
      vec2 suv = uv + uBlurDir * uBlur * t;
      vec2 ca = (suv - 0.5) * uAberration * r2;
      col.r += texture2D(tScene, suv + ca).r;
      col.g += texture2D(tScene, suv).g;
      col.b += texture2D(tScene, suv - ca).b;
    }
    col /= 3.0;

    col += texture2D(tBloom, uv).rgb * uBloom;

    col *= uExposure;
    col += uFlash;
    col = aces(col);

    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, 1.1);
    col = mix(col, col * vec3(1.05, 1.0, 0.95), smoothstep(0.45, 1.0, l));
    col = mix(col, col * vec3(0.93, 1.01, 1.07), smoothstep(0.45, 0.0, l));

    float vig = smoothstep(1.2, 0.28, length((vUv - 0.5) * vec2(1.12, 1.0)));
    col *= mix(1.0, vig, uVignette);

    float grain = hash(vUv * uResolution + fract(uTime) * 137.0) - 0.5;
    col += grain * uGrain;

    if (uAnalog > 0.001) {
      float scan = 0.5 + 0.5 * sin(vUv.y * uResolution.y * 1.4 + uTime * 30.0);
      col *= mix(1.0, 0.88 + 0.12 * scan, uAnalog);
      float n = hash(vUv * vec2(1920.0, 1080.0) + floor(uTime * 30.0));
      col += (n - 0.5) * 0.06 * uAnalog;
      col = mix(col, col * vec3(0.96, 1.0, 1.04), uAnalog * 0.6);
    }

    col = pow(max(col, 0.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface PostParams {
  blurDir: THREE.Vector2;
  blurAmount: number;
  analog: number;
  flash: number;
}

export class PostFX {
  private sceneRT: THREE.WebGLRenderTarget;
  private bloomA: THREE.WebGLRenderTarget;
  private bloomB: THREE.WebGLRenderTarget;
  private extract: FullScreenQuad;
  private blur: FullScreenQuad;
  private final: FullScreenQuad;
  private width = 1;
  private height = 1;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthBuffer: true,
    });
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    this.bloomB = this.bloomA.clone();

    this.extract = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: EXTRACT,
        uniforms: {
          tScene: { value: this.sceneRT.texture },
          uThreshold: { value: 1.5 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );

    this.blur = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: BLUR,
        uniforms: {
          tSrc: { value: null },
          uDir: { value: new THREE.Vector2() },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );

    this.final = new FullScreenQuad(
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FINAL,
        uniforms: {
          tScene: { value: this.sceneRT.texture },
          tBloom: { value: this.bloomA.texture },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uBlurDir: { value: new THREE.Vector2() },
          uTime: { value: 0 },
          uExposure: { value: 1.0 },
          uBloom: { value: 0.12 },
          uVignette: { value: 0.75 },
          uGrain: { value: 0.018 },
          uAberration: { value: 0.0016 },
          uDistortion: { value: 0.015 },
          uAnalog: { value: 0 },
          uBlur: { value: 0 },
          uFlash: { value: 0 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  setSize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(width * dpr));
    this.height = Math.max(1, Math.floor(height * dpr));

    // Render the world slightly under native and let the final pass upscale.
    // On integrated GPUs this is the difference between 30 and 60 fps.
    const sw = Math.max(1, Math.floor(this.width * 1.0));
    const sh = Math.max(1, Math.floor(this.height * 1.0));
    this.sceneRT.setSize(sw, sh);

    const bw = Math.max(1, Math.floor(sw / 4));
    const bh = Math.max(1, Math.floor(sh / 4));
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);

    const mat = this.final.material as THREE.ShaderMaterial;
    (mat.uniforms.uResolution?.value as THREE.Vector2).set(this.width, this.height);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, params: PostParams, elapsed: number): void {
    const renderer = this.renderer;

    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(scene, camera);

    const extractMat = this.extract.material as THREE.ShaderMaterial;
    extractMat.uniforms.tScene!.value = this.sceneRT.texture;
    renderer.setRenderTarget(this.bloomA);
    renderer.clear();
    this.extract.render(renderer);

    const blurMat = this.blur.material as THREE.ShaderMaterial;
    const bw = this.bloomA.width;
    const bh = this.bloomA.height;

    blurMat.uniforms.tSrc!.value = this.bloomA.texture;
    (blurMat.uniforms.uDir!.value as THREE.Vector2).set(1 / bw, 0);
    renderer.setRenderTarget(this.bloomB);
    renderer.clear();
    this.blur.render(renderer);

    blurMat.uniforms.tSrc!.value = this.bloomB.texture;
    (blurMat.uniforms.uDir!.value as THREE.Vector2).set(0, 1 / bh);
    renderer.setRenderTarget(this.bloomA);
    renderer.clear();
    this.blur.render(renderer);

    const finalMat = this.final.material as THREE.ShaderMaterial;
    finalMat.uniforms.uTime!.value = elapsed;
    finalMat.uniforms.uBlur!.value = params.blurAmount;
    finalMat.uniforms.uAnalog!.value = params.analog;
    finalMat.uniforms.uFlash!.value = params.flash;
    (finalMat.uniforms.uBlurDir!.value as THREE.Vector2).copy(params.blurDir);

    renderer.setRenderTarget(null);
    renderer.clear();
    this.final.render(renderer);
  }

  setBloomThreshold(v: number): void {
    const mat = this.extract.material as THREE.ShaderMaterial;
    mat.uniforms.uThreshold!.value = v;
  }

  /** Switch the whole look instantly, used when swapping maps. */
  setGrade(grade: {
    bloomThreshold: number;
    bloom: number;
    exposure: number;
    vignette: number;
    grain: number;
  }): void {
    const extract = this.extract.material as THREE.ShaderMaterial;
    extract.uniforms.uThreshold!.value = grade.bloomThreshold;
    const finalMat = this.final.material as THREE.ShaderMaterial;
    finalMat.uniforms.uBloom!.value = grade.bloom;
    finalMat.uniforms.uExposure!.value = grade.exposure;
    finalMat.uniforms.uVignette!.value = grade.vignette;
    finalMat.uniforms.uGrain!.value = grade.grain;
  }
}
