// bots.js — the nine non-player fighters. Each bot is a capsule-built
// character (legs, torso, head — separate hit zones) driven by a small
// state machine: follow a lane route, hold a post, engage what it sees,
// plant or defuse at the vault, and retreat to cover when hurt.
// Perception is honest: line of sight through map.segmentBlocked plus a
// view cone, and hearing — gunfire and loud footsteps set an alert point.

import * as THREE from 'three';
import { NODES, ADJ, nearestNode, findPath, moveWithCollision, segmentBlocked, SITE } from './map.js';
import { WEAPONS } from './state.js';

const TEAM_COLORS = { warden: 0x3f8fd2, breach: 0xd2543a };
const BOT_NAMES = {
  warden: ['Anvil', 'Bishop', 'Cinder', 'Dowel'],
  breach: ['Fable', 'Gouge', 'Havoc', 'Ilex', 'Rook'],
};
let nameIdx = { warden: 0, breach: 0 };
export function nextBotName(team) { return BOT_NAMES[team][nameIdx[team]++ % BOT_NAMES[team].length]; }

export function buildCharacterMesh(team) {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33302c, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.6 });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.78, 0.26), dark);
  legs.position.y = 0.39; legs.name = 'legs';
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), suit);
  chest.position.y = 1.09; chest.name = 'chest';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = 1.56; head.name = 'head';
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.18, 1.22, -0.3); gun.name = 'gun';
  g.add(legs, chest, head, gun);
  g.userData.parts = { legs, chest, head };
  return g;
}

// Which body part a ray hits first on this bot, or null. Uses simple
// sphere tests per part at world positions — cheap and deterministic.
const _v = new THREE.Vector3();
export function rayHitPart(bot, origin, dir) {
  const parts = [
    ['head', 1.56, 0.21], ['chest', 1.09, 0.34], ['legs', 0.42, 0.32],
  ];
  let best = null, bestT = Infinity;
  for (const [name, y, r] of parts) {
    _v.set(bot.pos.x, y, bot.pos.z).sub(origin);
    const t = _v.dot(dir);
    if (t < 0.5 || t > 90) continue;
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    const d2 = (px - bot.pos.x) ** 2 + (py - y) ** 2 + (pz - bot.pos.z) ** 2;
    if (d2 < r * r && t < bestT) { bestT = t; best = name; }
  }
  return best ? { part: best, dist: bestT } : null;
}

export class Bot {
  constructor(fighter, scene) {
    this.f = fighter;
    this.mesh = buildCharacterMesh(fighter.team);
    scene.add(this.mesh);
    this.pos = this.mesh.position;
    this.yaw = 0;
    this.state = 'route'; // route | hold | engage | plant | defuse | cover
    this.path = []; this.pathI = 0;
    this.targetPos = null; this.holdUntil = 0;
    this.enemy = null; this.lastSeen = null; this.lastSeenAt = -99;
    this.thinkAt = Math.random() * 0.2;
    this.fireAt = 0; this.burstLeft = 0; this.reloadUntil = 0;
    this.alertPos = null; this.hpMark = 100;
    this.strafeDir = 1; this.strafeAt = 0;
    this.speed = 4.4;
  }

  spawnAt(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.yaw = spawn.x < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.state = 'route'; this.enemy = null; this.path = [];
    this.mesh.visible = true;
  }

  setRouteTo(x, z) {
    const from = nearestNode(this.pos.x, this.pos.z);
    const to = nearestNode(x, z);
    this.path = findPath(from, to);
    this.pathI = 0;
    this.targetPos = { x, z };
  }

  // Defenders pick posts covering the vault and the lane mouths; attackers
  // push a lane toward the site. Posts differ per bot so the squad spreads.
  choosePlan(match, slotIndex) {
    if (this.f.team === match.attackTeam) {
      const lanes = [[22, -14], [19, 0], [22, 14]];
      const [x, z] = lanes[slotIndex % lanes.length];
      this.setRouteTo(x, z);
      this.state = 'route';
    } else {
      const posts = [[19, -4], [20, 5], [15, 0], [24, -9], [24, 9], [12, -9]];
      const [x, z] = posts[slotIndex % posts.length];
      this.setRouteTo(x, z);
      this.state = 'route';
      this.planPost = { x, z };
    }
  }

  canSee(otherPos, eyeY = 1.5) {
    const dx = otherPos.x - this.pos.x, dz = otherPos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) return false;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // Bot forward: yaw measured so that forward = (sin, -cos)? We keep yaw as
    // the mesh rotation; forward vector is (-sin(yaw), -cos(yaw)) in XZ when
    // yaw=0 faces -Z. Use the mesh direction instead:
    const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
    const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
    if (dist > 4 && dot < 0.25) return false;
    return !segmentBlocked(this.pos.x, this.pos.z, otherPos.x, otherPos.z, 1.05);
  }

  hear(pos) { this.alertPos = { x: pos.x, z: pos.z }; }

  update(dt, match, ctx) {
    const f = this.f;
    if (!f.alive) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const now = ctx.time;

    // --- perception (throttled) ---
    if (now >= this.thinkAt) {
      this.thinkAt = now + 0.12 + Math.random() * 0.08;
      let seen = null;
      for (const e of ctx.enemiesOf(f)) {
        if (!e.alive || !e.pos) continue;
        if (this.canSee(e.pos)) { seen = e; break; }
      }
      if (seen) {
        this.enemy = seen; this.lastSeen = { x: seen.pos.x, z: seen.pos.z }; this.lastSeenAt = now;
        if (this.state !== 'plant' && this.state !== 'defuse') this.state = 'engage';
      } else if (this.enemy && now - this.lastSeenAt > 2.2) {
        this.enemy = null;
        if (this.state === 'engage') this.state = this.alertPos ? 'route' : 'route';
      }
      // Hurt badly with no visible enemy: fall back toward a post.
      if (f.hp < 35 && !this.enemy && this.state !== 'cover') {
        this.state = 'cover';
        const post = this.planPost || { x: SITE.x + 4, z: 6 };
        this.setRouteTo(post.x, post.z);
      }
    }

    // --- objective play ---
    if (match.charge.planted) {
      if (f.team !== match.attackTeam && this.state !== 'engage') this.state = 'defuse';
      if (f.team === match.attackTeam && this.state !== 'engage') {
        this.state = 'hold';
        if (!this.holdPos) { this.holdPos = { x: SITE.x - 6 + Math.random() * 4, z: (Math.random() - 0.5) * 10 }; this.setRouteTo(this.holdPos.x, this.holdPos.z); }
      }
    } else if (f.hasCharge && f.team === match.attackTeam) {
      const dSite = Math.hypot(this.pos.x - SITE.x, this.pos.z - SITE.z);
      if (dSite < SITE.radius - 0.6) {
        this.state = 'plant';
        ctx.tryPlant(this, dt);
        this.faceToward(SITE.x + 3, SITE.z, dt);
        this.syncMesh();
        return;
      }
      if (this.state !== 'engage') { this.state = 'route'; if (!this.path.length && !this.targetPos) this.setRouteTo(SITE.x, SITE.z); }
    }
    if (this.state === 'defuse') {
      const dSite = Math.hypot(this.pos.x - SITE.x, this.pos.z - SITE.z);
      if (dSite > 2.2) { if (!this.path.length) this.setRouteTo(SITE.x, SITE.z); this.followPath(dt); }
      else { ctx.tryDefuse(this, dt); this.faceToward(SITE.x, SITE.z, dt); }
      this.syncMesh();
      return;
    }
    if (this.state === 'plant') { this.syncMesh(); return; }

    // --- combat movement + fire ---
    if (this.state === 'engage' && this.lastSeen) {
      const d = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
      this.faceToward(this.lastSeen.x, this.lastSeen.z, dt, 10);
      if (this.enemy) {
        // Strafe in short steps between bursts — moving targets are harder,
        // and the bot's own spread grows while it moves, like the player's.
        if (now >= this.strafeAt) { this.strafeAt = now + 0.5 + Math.random() * 0.6; this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        if (d > 9) this.moveToward(this.lastSeen.x, this.lastSeen.z, dt, this.speed);
        else {
          const px = -Math.cos(this.yaw) * this.strafeDir, pz = Math.sin(this.yaw) * this.strafeDir;
          moveWithCollision(this.pos, px * 1.6 * dt, pz * 1.6 * dt);
        }
        this.tryShoot(now, ctx);
      } else if (d > 1.2) {
        this.moveToward(this.lastSeen.x, this.lastSeen.z, dt, this.speed);
      }
      this.syncMesh();
      return;
    }

    // --- route following / holding ---
    if (this.path.length || this.targetPos) {
      const arrived = this.followPath(dt);
      if (arrived) {
        if (this.state === 'route' && this.planPost) { this.state = 'hold'; this.holdUntil = now + 6 + Math.random() * 6; }
        else if (this.state === 'route' && f.team === match.attackTeam) { this.state = 'hold'; this.holdUntil = now + 3; }
        else if (this.state === 'cover') { this.state = 'hold'; this.holdUntil = now + 4; }
        this.targetPos = null;
      }
    } else if (this.state === 'hold') {
      // Scan: slow yaw sweep while holding a post.
      this.yaw += Math.sin(now * 0.6 + this.pos.x) * dt * 0.5;
      if (now > this.holdUntil && !match.charge.planted) {
        if (f.team === match.attackTeam) this.setRouteTo(SITE.x, SITE.z);
        else if (this.planPost) this.setRouteTo(this.planPost.x, this.planPost.z);
        this.state = 'route';
      }
    }
    this.syncMesh();
  }

  followPath(dt) {
    let tx, tz;
    if (this.pathI < this.path.length) { const n = NODES[this.path[this.pathI]]; tx = n.x; tz = n.z; }
    else if (this.targetPos) { tx = this.targetPos.x; tz = this.targetPos.z; }
    else return true;
    const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    if (d < 0.9) {
      if (this.pathI < this.path.length) { this.pathI++; return false; }
      return true;
    }
    this.moveToward(tx, tz, dt, this.speed);
    return false;
  }

  moveToward(x, z, dt, speed) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.faceToward(x, z, dt, 6);
    moveWithCollision(this.pos, (dx / d) * speed * dt, (dz / d) * speed * dt);
  }

  faceToward(x, z, dt, rate = 8) {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * rate);
  }

  tryShoot(now, ctx) {
    const f = this.f;
    const w = WEAPONS[f.current];
    const ammo = f.ammo[f.current];
    if (now < this.reloadUntil) return;
    if (ammo.mag <= 0) {
      const need = w.mag - ammo.mag;
      const take = Math.min(need, ammo.reserve === Infinity ? need : ammo.reserve);
      if (take > 0) { ammo.mag += take; if (ammo.reserve !== Infinity) ammo.reserve -= take; }
      this.reloadUntil = now + w.reload;
      return;
    }
    if (now < this.fireAt) return;
    if (this.burstLeft <= 0) {
      // Reaction delay scaled by distance: closer reads faster.
      const d = Math.hypot(this.enemy.pos.x - this.pos.x, this.enemy.pos.z - this.pos.z);
      this.fireAt = now + 0.22 + Math.random() * 0.25 + d * 0.004;
      this.burstLeft = w.auto ? 3 + (Math.random() * 4 | 0) : 1;
      return;
    }
    this.burstLeft--;
    this.fireAt = now + 60 / w.rpm;
    ammo.mag--;
    ctx.botShoot(this, w);
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    const moving = this.state === 'route' || this.state === 'engage';
    const swing = moving ? Math.sin(performance.now() * 0.012 + this.pos.x) * 0.3 : 0;
    this.mesh.userData.parts.legs.rotation.x = swing;
  }
}
