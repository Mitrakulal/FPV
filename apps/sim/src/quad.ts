import * as THREE from 'three';

export interface QuadModel {
  group: THREE.Group;
  propGroups: THREE.Object3D[];
  discs: THREE.Mesh[];
  leds: THREE.Mesh[];
}

/**
 * A 5" freestyle quad at roughly real scale. It only has to look right in the
 * chase camera and cast a believable shadow in FPV.
 */
export function buildQuad(): QuadModel {
  const group = new THREE.Group();

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
  group.add(plate);

  const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.004, 0.078), carbonEdge);
  topPlate.position.y = 0.042;
  group.add(topPlate);

  // four arms + motors
  const propGroups: THREE.Object3D[] = [];
  const discs: THREE.Mesh[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = i === 0 || i === 2 ? 1 : -1;
    const sz = i < 2 ? -1 : 1;

    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.0045, 0.013), carbon);
    arm.position.set((sx * armLen) / 2, 0.006, (sz * armLen) / 2);
    arm.rotation.y = Math.atan2(sz, sx);
    group.add(arm);

    const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.012, 18), alloy);
    stator.position.set(sx * armLen, 0.016, sz * armLen);
    group.add(stator);

    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0145, 0.012, 20), anodised);
    bell.position.set(sx * armLen, 0.026, sz * armLen);
    group.add(bell);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 16), alloy);
    cap.position.set(sx * armLen, 0.0325, sz * armLen);
    group.add(cap);

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
  group.add(battery);

  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(0.058, 0.004, 0.016),
    new THREE.MeshStandardMaterial({ color: 0xd8492b, roughness: 0.8 }),
  );
  strap.position.set(0, 0.066, 0.004);
  group.add(strap);

  // FPV camera pod, tilted up like a real race cam
  const camPod = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.02), carbonEdge);
  camPod.position.set(0, 0.036, -0.05);
  camPod.rotation.x = -0.5;
  group.add(camPod);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.012, 18), alloy);
  lens.position.set(0, 0.045, -0.06);
  lens.rotation.x = Math.PI / 2 - 0.5;
  group.add(lens);

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
  group.add(glass);

  // VTX antenna
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 8), carbonEdge);
  antenna.position.set(0, 0.075, 0.055);
  antenna.rotation.x = 0.55;
  group.add(antenna);

  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x6b2fb3, roughness: 0.5 }),
  );
  antennaTip.position.set(0, 0.105, 0.075);
  group.add(antennaTip);

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
    group.add(led);
    leds.push(led);
  }

  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });

  return { group, propGroups, discs, leds };
}
