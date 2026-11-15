// weapons.js — viewmodels, hitscan shooting with a spread/recoil model,
// tracers, impact puffs, muzzle flash, reloads and the flash pellet.
// Hits are resolved by main.js through the callback this module is given:
// it reports each pellet's ray; main checks bodies (head/chest/legs) and walls.

import * as THREE from 'three';
import { WEAPONS } from './state.js';
import { sfx } from './audio.js';

const KIND = { kestrel: 'pistol', ember_rifle: 'rifle', longshot: 'dmr', scatter: 'scatter', wasp: 'smg' };

export class WeaponRig {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.group = new THREE.Group();
    camera.add(this.group);
    this.models = {};
    for (const id of Object.keys(WEAPONS)) this.models[id] = this.buildModel(id);
    this.current = null;
    this.setWeapon('kestrel');
    this.cooldown = 0; this.reloading = 0; this.reloadFor = null;
    this.triggerHeld = false; this.flashTime = 0;
    this.tracers = []; // {line, life}
    this.muzzle = null;
    this.onShoot = null; // (origin, dir, weapon) => void, set by main
    this.kick = 0;
  }

  buildModel(id) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.45, metalness: 0.55 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9962e, roughness: 0.3, metalness: 0.8 });
    const ember = new THREE.MeshBasicMaterial({ color: 0xff8c2e });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
    };
    if (id === 'kestrel') {
      add(new THREE.BoxGeometry(0.07, 0.1, 0.26), dark, 0, 0, -0.05);
      add(new THREE.BoxGeometry(0.06, 0.14, 0.08), wood, 0, -0.1, 0.05);
    } else if (id === 'scatter') {
      add(new THREE.BoxGeometry(0.08, 0.09, 0.62), dark, 0, 0, -0.2);
      add(new THREE.BoxGeometry(0.07, 0.07, 0.3), wood, 0, -0.03, -0.05);
      add(new THREE.BoxGeometry(0.06, 0.15, 0.09), wood, 0, -0.11, 0.14);
    } else if (id === 'longshot') {
      add(new THREE.BoxGeometry(0.06, 0.08, 0.85), dark, 0, 0, -0.3);
      add(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 10), dark, 0, 0.075, -0.25).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.055, 0.13, 0.08), wood, 0, -0.1, 0.1);
    } else { // rifle and SMG share a frame; the SMG is shorter with a drum
      const len = id === 'wasp' ? 0.42 : 0.58;
      add(new THREE.BoxGeometry(0.065, 0.09, len), dark, 0, 0, -len / 2 + 0.05);
      add(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark, 0, -0.11, -0.02);
      add(new THREE.BoxGeometry(0.055, 0.12, 0.08), wood, 0, -0.09, 0.16);
      add(new THREE.BoxGeometry(0.02, 0.05, 0.02), ember, 0, 0.065, -0.12);
      if (id === 'wasp') add(new THREE.CylinderGeometry(0.055, 0.055, 0.09, 12), brass, 0, -0.1, -0.12).rotation.x = 0.3;
    }
    g.position.set(0.24, -0.22, -0.45);
    g.visible = false;
    this.group.add(g);
    return g;
  }

  setWeapon(id) {
    if (this.current) this.models[this.current].visible = false;
    this.current = id;
    this.models[id].visible = true;
    this.reloading = 0;
  }

  // Attempt to fire. spreadScale comes from the shooter's stance (player
  // spreadFactor or a bot accuracy value). Returns true if a shot went out.
  tryFire(fighter, dt, spreadScale, aimDir, origin) {
    const w = WEAPONS[this.current];
    const ammo = fighter.ammo[this.current];
    this.cooldown -= dt;
    if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) this.finishReload(fighter); return false; }
    if (!this.triggerHeld || this.cooldown > 0) return false;
    if (!w.auto) { this.triggerHeld = false; } // semi-auto: one shot per click
    if (ammo.mag <= 0) { sfx.dryFire(); this.cooldown = 0.3; return false; }
    ammo.mag -= 1;
    this.cooldown = 60 / w.rpm;
    sfx.shot(KIND[this.current]);
    const spread = (w.spreadStill + w.spreadMove * Math.max(0, spreadScale - 1)) * Math.min(spreadScale, 3);
    for (let p = 0; p < w.pellets; p++) {
      const dir = aimDir.clone();
      dir.x += (Math.random() - 0.5) * 2 * spread;
      dir.y += (Math.random() - 0.5) * 2 * spread;
      dir.z += (Math.random() - 0.5) * 2 * spread;
      dir.normalize();
      if (this.onShoot) this.onShoot(origin, dir, w, fighter);
    }
    this.kick = Math.min(0.05, this.kick + w.recoil * 0.6);
    this.flashMuzzle();
    return true;
  }

  startReload(fighter) {
    const w = WEAPONS[this.current];
    const ammo = fighter.ammo[this.current];
    if (this.reloading > 0 || ammo.mag >= w.mag || ammo.reserve <= 0) return;
    this.reloading = w.reload;
    this.reloadFor = fighter;
    sfx.reload();
  }

  finishReload(fighter) {
    const w = WEAPONS[this.current];
    const ammo = fighter.ammo[this.current];
    const need = w.mag - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    if (ammo.reserve !== Infinity) ammo.reserve -= take;
  }

  flashMuzzle() {
    if (!this.muzzle) {
      this.muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.95 }));
      this.group.add(this.muzzle);
    }
    const w = WEAPONS[this.current];
    this.muzzle.position.set(0.24, -0.2, -0.45 - (w.id === 'longshot' ? 0.8 : 0.55));
    this.muzzle.visible = true;
    this.flashTime = 0.045;
  }

  addTracer(from, to, color = 0xffd9a0) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  addImpact(at, color = 0xd8c9a8) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    puff.position.copy(at);
    this.scene.add(puff);
    this.tracers.push({ line: puff, life: 0.16, puff: true });
  }

  update(dt) {
    if (this.flashTime > 0) { this.flashTime -= dt; if (this.flashTime <= 0 && this.muzzle) this.muzzle.visible = false; }
    this.kick *= Math.pow(0.000001, dt);
    this.group.position.y = -this.kick * 0.6;
    this.group.rotation.x = this.kick * 1.4;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.puff) t.line.scale.multiplyScalar(1 + dt * 6);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry?.dispose?.();
        this.tracers.splice(i, 1);
      }
    }
  }
}

// Damage for one pellet: distance falloff, then body-part multiplier, then
// armour. Headshots ignore the vest but a helmet halves them.
export function pelletDamage(weapon, dist, part, target) {
  let dmg = weapon.damage;
  if (dist > weapon.rangeStart) dmg *= Math.pow(weapon.falloff, dist - weapon.rangeStart);
  if (part === 'head') {
    dmg *= weapon.headMult;
    if (target.helmet) dmg *= 0.5;
  } else if (part === 'chest') {
    if (target.armor > 0) dmg *= 0.5;
  } else { // legs
    dmg *= 0.75;
  }
  return Math.max(1, Math.round(dmg));
}
