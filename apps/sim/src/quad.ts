import * as THREE from 'three';

export interface QuadModel {
  group: THREE.Group;
  propGroups: THREE.Object3D[];
  discs: THREE.Mesh[];
  blades: THREE.Mesh[];
  leds: THREE.Mesh[];
  /** True while the view sits inside the airframe. */
  firstPerson: boolean;
  /**
   * FPV mode. The camera sits inside the airframe, so the body is hidden from
   * the colour pass while staying in the shadow pass: you get the moving
   * shadow a real quad throws without staring at the inside of the frame.
   */
  setFirstPerson(on: boolean): void;
}

/**
 * A 5" freestyle quad at roughly real scale. It only has to look right in the
 * chase camera and cast a believable shadow in FPV.
 */
export function buildQuad(): QuadModel {
  const group = new THREE.Group();
  // Everything except the props. Kept in its own group so FPV can hide the
  // colour output of the airframe without dropping it out of the shadow map.
  const body = new THREE.Group();
  group.add(body);

  const carbon = new THREE.MeshStandardMaterial({
    color: 0x15171b,
    roughness: 0.55,
    metalness: 0.25,
  });
  const carbonEdge = new THREE.MeshStandardMaterial({
    color: 0x24282f,
    roughness: 0.42,
    metalness: 0.35,
  });
  const alloy = new THREE.MeshStandardMaterial({
    color: 0x8d939c,
    roughness: 0.32,
    metalness: 0.95,
  });
  const anodised = new THREE.MeshStandardMaterial({
    color: 0x1d4f8a,
    roughness: 0.35,
    metalness: 0.85,
  });
  const propMat = new THREE.MeshStandardMaterial({
    color: 0x2f6fd0,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  // FPV sits between the props: they sweep past as dark translucent blades,
  // never as solid colour. Same geometry, different material.
  const fpvPropMat = new THREE.MeshBasicMaterial({
    color: 0x12171f,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const blurMat = new THREE.MeshBasicMaterial({
    color: 0x9fb6cc,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const armLen = 0.115;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.004, 0.108), carbon);
  plate.position.y = 0.008;
  body.add(plate);

  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.004, 0.078), carbonEdge);
  topPlate.position.y = 0.042;
  body.add(topPlate);

  // four arms + motors
  const propGroups: THREE.Object3D[] = [];
  const discs: THREE.Mesh[] = [];
  const blades: THREE.Mesh[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = i === 0 || i === 2 ? 1 : -1;
    const sz = i < 2 ? -1 : 1;

    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.0045, 0.013), carbon);
    arm.position.set((sx * armLen) / 2, 0.006, (sz * armLen) / 2);
    arm.rotation.y = Math.atan2(sz, sx);
    body.add(arm);

    const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.012, 18), alloy);
    stator.position.set(sx * armLen, 0.016, sz * armLen);
    body.add(stator);

    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0145, 0.012, 20), anodised);
    bell.position.set(sx * armLen, 0.026, sz * armLen);
    body.add(bell);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 16), alloy);
    cap.position.set(sx * armLen, 0.0325, sz * armLen);
    body.add(cap);

    const propGroup = new THREE.Group();
    propGroup.position.set(sx * armLen, 0.035, sz * armLen);
    for (let b = 0; b < 3; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.0016, 0.011), propMat);
      blade.position.set(0.035, 0, 0);
      blade.rotation.z = 0.28;
      const pivot = new THREE.Group();
      pivot.rotation.y = (b / 3) * Math.PI * 2;
      pivot.add(blade);
      propGroup.add(pivot);
      blades.push(blade);
    }
    group.add(propGroup);
    propGroups.push(propGroup);

    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.066, 28), blurMat.clone());
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(sx * armLen, 0.036, sz * armLen);
    group.add(disc);
    discs.push(disc);
  }

  // battery + strap
  const battery = new THREE.Mesh(
    new THREE.BoxGeometry(0.052, 0.021, 0.084),
    new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.7 }),
  );
  battery.position.set(0, 0.055, 0.004);
  body.add(battery);

  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(0.058, 0.004, 0.016),
    new THREE.MeshStandardMaterial({ color: 0xd8492b, roughness: 0.8 }),
  );
  strap.position.set(0, 0.066, 0.004);
  body.add(strap);

  // FPV camera pod, tilted up like a real race cam
  const camPod = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.02), carbonEdge);
  camPod.position.set(0, 0.036, -0.05);
  camPod.rotation.x = -0.5;
  body.add(camPod);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.012, 18), alloy);
  lens.position.set(0, 0.045, -0.06);
  lens.rotation.x = Math.PI / 2 - 0.5;
  body.add(lens);

  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.007, 18),
    new THREE.MeshStandardMaterial({
      color: 0x0a1a24,
      roughness: 0.05,
      metalness: 0.9,
    }),
  );
  glass.position.set(0, 0.048, -0.067);
  glass.rotation.x = -0.5;
  body.add(glass);

  // VTX antenna
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 8), carbonEdge);
  antenna.position.set(0, 0.075, 0.055);
  antenna.rotation.x = 0.55;
  body.add(antenna);

  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b2fb3, roughness: 0.5 }),
  );
  antennaTip.position.set(0, 0.105, 0.075);
  body.add(antennaTip);

  // status LEDs
  const leds: THREE.Mesh[] = [];
  const ledCols = [0x30ff9a, 0x30ff9a, 0xff3344, 0xff3344];
  for (let i = 0; i < 4; i++) {
    const sx = i === 0 || i === 2 ? 1 : -1;
    const sz = i < 2 ? -1 : 1;
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.0022, 8, 6),
      new THREE.MeshStandardMaterial({
        color: ledCols[i] ?? 0xffffff,
        emissive: ledCols[i] ?? 0xffffff,
        emissiveIntensity: 2.5,
      }),
    );
    led.position.set(sx * armLen, 0.005, sz * armLen + 0.012);
    body.add(led);
    leds.push(led);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  // Prop wash planes are invisible geometry. If they stay in the shadow pass the
  // quad throws four solid circles instead of prop blades.
  for (const d of discs) d.castShadow = false;

  // Airframe-only materials. Flipping colorWrite on these hides the body from
  // the camera while the meshes still render into the shadow map, so FPV keeps
  // the moving shadow a real quad throws without showing the frame you sit in.
  const bodyMaterials = new Set<THREE.Material>();
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) bodyMaterials.add(m);
  });

  const model: QuadModel = {
    group,
    propGroups,
    discs,
    blades,
    leds,
    firstPerson: false,
    setFirstPerson(on: boolean) {
      model.firstPerson = on;
      group.visible = true;
      for (const m of bodyMaterials) {
        m.colorWrite = !on;
        m.depthWrite = !on;
      }
      // In FPV the front props sweep past the lens. They are redrawn with a dark
      // translucent material so they read as blur, not solid blue paddles.
      for (const b of blades) b.material = on ? fpvPropMat : propMat;
      for (const d of discs) d.visible = !on;
    },
  };
  return model;
}
