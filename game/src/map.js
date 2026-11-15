// map.js — "The Foundry": an original three-lane map around a central vault.
// North lane (Furnace Row), middle (the Vault yard), south lane (Canal Run),
// joined by two cross passages. Geometry, collision boxes, bot waypoints,
// spawns and the plant site are all defined here, once, from one layout table.

import * as THREE from 'three';

export const PALETTE = {
  floor: 0x4c4238, floorAlt: 0x584a3c, wall: 0x6e5b45, wallDark: 0x54432f,
  crate: 0x8a6b42, crateAlt: 0x74604a, metal: 0x707880, ember: 0xff8c2e,
  vault: 0xb8862e, wardTrim: 0x57c7ff, breachTrim: 0xff5d47, sky: 0x59402a,
};

// Solid boxes: {x,z} centre, {w,d} footprint, h height. Also used as the
// collision set and (for the low ones) as cover bots path around.
export const BOXES = [
  // Outer walls (the yard is 64 x 44, centred on the origin)
  { x: 0, z: -22.5, w: 66, d: 1, h: 6 }, { x: 0, z: 22.5, w: 66, d: 1, h: 6 },
  { x: -32.5, z: 0, w: 1, d: 46, h: 6 }, { x: 32.5, z: 0, w: 1, d: 46, h: 6 },
  // Furnace Row (north lane) structures
  { x: -18, z: -16, w: 10, d: 5, h: 4.2, kind: 'furnace' }, { x: 4, z: -16, w: 8, d: 5, h: 4.2, kind: 'furnace' },
  { x: -6, z: -11, w: 2, d: 2, h: 1.2, kind: 'crate' }, { x: 14, z: -12, w: 3, d: 2, h: 1.2, kind: 'crate' },
  // Mid blocks splitting the lanes
  { x: -14, z: -6, w: 12, d: 3, h: 3.4 }, { x: 12, z: -6, w: 14, d: 3, h: 3.4 },
  { x: -14, z: 7, w: 12, d: 3, h: 3.4 }, { x: 12, z: 7, w: 14, d: 3, h: 3.4 },
  // Vault yard cover
  { x: -4, z: 0, w: 2.4, d: 2.4, h: 1.2, kind: 'crate' }, { x: 7, z: 1, w: 2.4, d: 3.4, h: 1.7, kind: 'crate' },
  { x: -11, z: 1, w: 1.6, d: 5, h: 2.6 }, { x: 18, z: 0, w: 2, d: 6, h: 2.6 },
  // Canal Run (south lane) structures
  { x: -18, z: 16, w: 9, d: 5, h: 3.6, kind: 'shed' }, { x: 8, z: 16, w: 10, d: 5, h: 3.6, kind: 'shed' },
  { x: -4, z: 12, w: 2, d: 2, h: 1.2, kind: 'crate' }, { x: 20, z: 12, w: 2.4, d: 2, h: 1.2, kind: 'crate' },
  // Spawn-yard props
  { x: -26, z: -4, w: 2, d: 4, h: 1.7, kind: 'crate' }, { x: 27, z: 5, w: 2, d: 4, h: 1.7, kind: 'crate' },
  { x: -26, z: 8, w: 3, d: 2, h: 1.2, kind: 'crate' }, { x: 27, z: -8, w: 3, d: 2, h: 1.2, kind: 'crate' },
];

// The vault plinth: the plant site. Standing inside the radius with the
// charge and holding E plants it.
export const SITE = { x: 24, z: 0, radius: 3.4 };

export const SPAWNS = {
  warden: [ // defenders start east, near the vault
    { x: 28, z: -3, a: Math.PI }, { x: 28, z: 3, a: Math.PI }, { x: 26, z: -7, a: Math.PI },
    { x: 26, z: 7, a: Math.PI }, { x: 29, z: 0, a: Math.PI },
  ],
  breach: [ // attackers start west
    { x: -28, z: -3, a: 0 }, { x: -28, z: 3, a: 0 }, { x: -26, z: -7, a: 0 },
    { x: -26, z: 7, a: 0 }, { x: -29, z: 0, a: 0 },
  ],
};

// Waypoint graph for bot navigation: nodes with neighbour indices. Routes run
// west spawn -> three lanes -> vault, plus the two cross passages.
export const NODES = [
  { x: -27, z: 0 }, { x: -20, z: 0 }, { x: -20, z: -14 }, { x: -20, z: 14 },
  { x: -8, z: -14 }, { x: -8, z: 0 }, { x: -8, z: 14 }, { x: -8, z: -8 },
  { x: -8, z: 9 }, { x: 4, z: -14 }, { x: 4, z: 0 }, { x: 4, z: 14 },
  { x: 4, z: -9 }, { x: 4, z: 10 }, { x: 16, z: -14 }, { x: 16, z: 0 },
  { x: 16, z: 14 }, { x: 16, z: -9 }, { x: 16, z: 10 }, { x: 24, z: 0 },
  { x: 27, z: -6 }, { x: 27, z: 6 }, { x: 22, z: -14 }, { x: 22, z: 14 },
  { x: -20, z: -8 }, { x: -20, z: 9 },
];
export const EDGES = [
  [0, 1], [1, 2], [1, 3], [1, 24], [1, 25], [2, 4], [2, 24], [3, 6], [3, 25],
  [4, 9], [4, 7], [5, 1], [5, 7], [5, 8], [6, 11], [6, 8], [7, 12], [8, 13],
  [9, 14], [9, 12], [10, 5], [10, 15], [11, 16], [11, 13], [12, 17], [13, 18],
  [14, 22], [14, 17], [15, 19], [15, 17], [15, 18], [16, 23], [16, 18],
  [19, 20], [19, 21], [20, 22], [21, 23], [24, 7], [25, 8],
];
export const ADJ = NODES.map(() => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i].x - x, dz = NODES[i].z - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Breadth-first path over the waypoint graph; returns node indices.
export function findPath(fromIdx, toIdx) {
  if (fromIdx === toIdx) return [toIdx];
  const prev = new Array(NODES.length).fill(-1);
  const queue = [fromIdx]; prev[fromIdx] = fromIdx;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of ADJ[cur]) {
      if (prev[n] === -1) { prev[n] = cur; queue.push(n); }
    }
    if (prev[toIdx] !== -1) break;
  }
  if (prev[toIdx] === -1) return [toIdx];
  const path = [];
  let cur = toIdx;
  while (cur !== fromIdx) { path.unshift(cur); cur = prev[cur]; }
  return path;
}

// AABB collision: does a circle at (x,z) radius r overlap any tall box?
// Low crates (h <= 1.3) still block walking; you cannot step onto them.
export function collides(x, z, r = 0.42) {
  for (const b of BOXES) {
    if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return b;
  }
  return null;
}

// Slide-resolved movement: try x, then z, so walls are hugged, not stuck on.
export function moveWithCollision(pos, dx, dz, r = 0.42) {
  if (!collides(pos.x + dx, pos.z, r)) pos.x += dx;
  if (!collides(pos.x, pos.z + dz, r)) pos.z += dz;
  pos.x = Math.max(-31.5, Math.min(31.5, pos.x));
  pos.z = Math.max(-21.5, Math.min(21.5, pos.z));
}

// Segment vs boxes for line of sight / bullet blocking (2D, ignores height
// under 1.0 — shots over low crates pass, shots into tall walls stop).
export function segmentBlocked(x1, z1, x2, z2, minH = 1.0) {
  for (const b of BOXES) {
    if (b.h < minH) continue;
    if (segmentHitsBox(x1, z1, x2, z2, b)) return b;
  }
  return null;
}
function segmentHitsBox(x1, z1, x2, z2, b) {
  const minX = b.x - b.w / 2, maxX = b.x + b.w / 2, minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dz, z1 - minZ], [dz, maxZ - z1]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return t0 <= t1;
}

// Build the three.js scene for the layout above.
export function buildWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 55, 120);
  const hemi = new THREE.HemisphereLight(0xffe0b8, 0x3a2a1a, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc98a, 2.4);
  sun.position.set(-18, 30, -12);
  scene.add(sun);
  const vaultGlow = new THREE.PointLight(PALETTE.ember, 60, 26, 1.8);
  vaultGlow.position.set(SITE.x, 3.4, SITE.z);
  scene.add(vaultGlow);

  const floorMat = new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(66, 0.2, 46), floorMat);
  floor.position.y = -0.1;
  scene.add(floor);
  // Lane markings: pale strips down each lane and a ring at the site.
  const markMat = new THREE.MeshBasicMaterial({ color: 0xcbb27f });
  for (const z of [-14, 0, 14]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(60, 0.02, 0.35), markMat);
    strip.position.set(0, 0.012, z);
    scene.add(strip);
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SITE.radius - 0.25, SITE.radius, 40),
    new THREE.MeshBasicMaterial({ color: PALETTE.ember, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.015, SITE.z);
  scene.add(ring);

  // Boxes become meshes: furnaces get ember slits, sheds a metal roof tone,
  // crates the lighter wood; everything else is dressed stone.
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.85 }),
    crateAlt: new THREE.MeshStandardMaterial({ color: PALETTE.crateAlt, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.5, metalness: 0.6 }),
    ember: new THREE.MeshBasicMaterial({ color: PALETTE.ember }),
    vault: new THREE.MeshStandardMaterial({ color: PALETTE.vault, roughness: 0.35, metalness: 0.8 }),
  };
  for (const b of BOXES) {
    const isWall = b.h >= 6;
    const mat = isWall ? mats.dark : b.kind === 'crate' ? mats.crate : b.kind === 'shed' ? mats.metal : mats.wall;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mat);
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
    if (b.kind === 'furnace') {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.7, 0.35, 0.1), mats.ember);
      slit.position.set(b.x, 1.1, b.z + (b.z < 0 ? b.d / 2 + 0.06 : -b.d / 2 - 0.06));
      scene.add(slit);
    }
  }
  // The vault itself: a gold drum on a plinth at the site, with a beacon.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.5, 20), mats.metal);
  plinth.position.set(SITE.x, 0.25, SITE.z);
  scene.add(plinth);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.7, 20), mats.vault);
  drum.position.set(SITE.x, 1.35, SITE.z);
  scene.add(drum);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.ember, transparent: true, opacity: 0.5 }));
  beacon.position.set(SITE.x, 6.2, SITE.z);
  scene.add(beacon);
  // Spawn banners so each end of the map reads at a glance.
  for (const [x, color] of [[-30.5, PALETTE.breachTrim], [30.5, PALETTE.wardTrim]]) {
    const banner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 10),
      new THREE.MeshBasicMaterial({ color }));
    banner.position.set(x, 3.4, 0);
    scene.add(banner);
  }
  return { vaultGlow, drum };
}
