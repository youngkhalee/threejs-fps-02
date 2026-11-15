// player.js — first-person controller: pointer-lock mouse look, WASD with
// acceleration and friction, crouch, jump, and AABB collision from map.js.
// Speed feeds the weapon spread model: standing still is accurate, running
// is not, crouching is best of all.

import * as THREE from 'three';
import { moveWithCollision } from './map.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
const WALK = 5.2, CROUCH_SPEED = 2.4, QUIET = 3.0; // quiet = walk-key speed
const ACCEL = 42, FRICTION = 10;

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.pos = new THREE.Vector3(-28, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.crouch = false; this.onGround = true; this.eye = EYE_STAND;
    this.keys = new Set();
    this.locked = false;
    this.recoilPitch = 0; // added by weapons, decays in update
    this.bobPhase = 0; this.bobAmount = 0;
    this.stepAcc = 0;
    this.onStep = null;
    this.bind();
  }

  bind() {
    this.dom.addEventListener('click', () => { /* lock requested by main */ });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['Space', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  requestLock() { this.dom.requestPointerLock?.(); }

  placeAt(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.a === 0 ? -Math.PI / 2 : Math.PI / 2; // face map centre
    // spawn.a stores facing as map angle; convert: yaw 0 looks down -Z.
    this.yaw = Math.atan2(-(0 - spawn.x), -(0 - spawn.z)) + Math.PI;
    this.pitch = 0; this.vel.set(0, 0, 0);
  }

  get speed2D() { return Math.hypot(this.vel.x, this.vel.z); }
  get moving() { return this.speed2D > 0.4; }
  get quiet() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  // Spread multiplier from stance: the heart of "accuracy counts".
  spreadFactor(weapon) {
    let f = 1;
    const sp = this.speed2D;
    if (!this.onGround) f = 4.2;
    else if (sp > 3.4) f = 1 + (sp - 3.4) * 1.1;      // running: blooms fast
    else if (sp > 0.4) f = 1.25;                        // walking
    if (this.crouch) f *= 0.55;
    return f;
  }

  update(dt) {
    const k = this.keys;
    this.crouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward is -Z rotated by yaw.
    let wx = (-sin * fwd + cos * strafe);
    let wz = (-cos * fwd - sin * strafe);
    const len = Math.hypot(wx, wz) || 1;
    wx /= len; wz /= len;
    let maxSpeed = this.crouch ? CROUCH_SPEED : WALK;
    if (this.quiet) maxSpeed = Math.min(maxSpeed, QUIET);
    const activeWeaponSpeed = this.weaponSpeed ?? 1;
    maxSpeed *= activeWeaponSpeed;

    if (fwd || strafe) {
      this.vel.x += wx * ACCEL * dt;
      this.vel.z += wz * ACCEL * dt;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > maxSpeed) { this.vel.x *= maxSpeed / sp; this.vel.z *= maxSpeed / sp; }
    } else {
      const drop = Math.max(0, 1 - FRICTION * dt);
      this.vel.x *= drop; this.vel.z *= drop;
    }
    if (k.has('Space') && this.onGround) { this.vel.y = 4.6; this.onGround = false; }
    if (!this.onGround) {
      this.vel.y -= 13.5 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    }
    moveWithCollision(this.pos, this.vel.x * dt, this.vel.z * dt);

    const targetEye = this.crouch ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 11);
    this.recoilPitch *= Math.pow(0.0001, dt); // fast decay back to aim
    if (this.moving && this.onGround) {
      this.bobPhase += dt * this.speed2D * 1.6;
      this.bobAmount = Math.min(0.035, this.bobAmount + dt * 0.1);
      this.stepAcc += this.speed2D * dt;
      if (this.stepAcc > 2.6 && !this.quiet && this.onStep) { this.stepAcc = 0; this.onStep(); }
    } else {
      this.bobAmount = Math.max(0, this.bobAmount - dt * 0.12);
    }
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmount;
    this.camera.position.set(this.pos.x, this.pos.y + this.eye + bobY, this.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
    this.camera.rotation.z = Math.sin(this.bobPhase) * this.bobAmount * 0.35;
  }

  // Unit forward vector of the camera (for shooting and bot hearing checks).
  forward(out) {
    out.set(0, 0, -1).applyEuler(this.camera.rotation);
    return out;
  }
}
