// main.js — Ember Vault: wires the world, player, weapons, bots and HUD
// into a round-based match. Fixed-step simulation (60 Hz) kept apart from
// rendering: step() advances the game, render() only draws and reads state.
//
// Flow: menu -> buy (14 s, B reopens) -> live (100 s) -> planted (38 s
// charge) -> roundEnd (4 s) -> next buy ... first to 7 rounds wins.

import * as THREE from 'three';
import { buildWorld, SITE, SPAWNS, segmentBlocked } from './map.js';
import { Player } from './player.js';
import { WeaponRig, pelletDamage } from './weapons.js';
import { Bot, rayHitPart, nextBotName } from './bots.js';
import { Hud } from './hud.js';
import { ensureAudio, sfx } from './audio.js';
import {
  TEAM, TEAM_NAME, WIN_SCORE, ROUND_TIME, BUY_TIME, PLANT_TIME, DEFUSE_TIME,
  CHARGE_TIME, WEAPONS, GEAR, createFighter, giveWeapon, createMatch,
  awardRoundEnd, resetRoundLoadouts,
} from './state.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // menu | buy | combat | end — screenshot staging

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 300);
scene.add(camera);
buildWorld(scene);

const hud = new Hud();
const player = new Player(camera, renderer.domElement);
const rig = new WeaponRig(camera, scene);

let match = null;
let bots = new Map(); // fighter -> Bot
let simTime = 0;
let plantProgress = 0, defuseProgress = 0;
let plantingBy = null, defusingBy = null;
let flashEvents = []; // {at: Vector3, t}
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();

function allFighters() { return match.fighters; }
function enemiesOf(f) { return match.fighters.filter(e => e.team !== f.team); }
function aliveCount(team) { return match.fighters.filter(f => f.team === team && f.alive).length; }

function setupMatch(playerTeam) {
  match = createMatch(playerTeam);
  bots = new Map();
  const pf = createFighter('You', playerTeam, true);
  pf.pos = player.pos;
  match.fighters.push(pf);
  match.playerFighter = pf;
  for (const team of [TEAM.WARDEN, TEAM.BREACH]) {
    const count = team === playerTeam ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const f = createFighter(nextBotName(team), team);
      const bot = new Bot(f, scene);
      f.pos = bot.pos;
      bots.set(f, bot);
      match.fighters.push(f);
    }
  }
  rig.onShoot = (origin, dir, weapon, fighter) => resolveShot(origin, dir, weapon, fighter);
}

// ---------- shooting ----------
function resolveShot(origin, dir, weapon, fighter) {
  match.stats.shots++;
  let bestBot = null, bestHit = null;
  for (const e of enemiesOf(fighter)) {
    if (!e.alive || e.isPlayer) continue;
    const bot = bots.get(e);
    const hit = rayHitPart(bot, origin, dir);
    if (hit && (!bestHit || hit.dist < bestHit.dist)) { bestHit = hit; bestBot = e; }
  }
  let endDist = 70;
  if (bestHit) {
    // A wall between muzzle and target eats the shot.
    const hx = origin.x + dir.x * bestHit.dist, hz = origin.z + dir.z * bestHit.dist;
    const minH = bestHit.part === 'head' ? 1.45 : bestHit.part === 'chest' ? 0.95 : 0.25;
    if (!segmentBlocked(origin.x, origin.z, hx, hz, minH)) {
      endDist = bestHit.dist;
      match.stats.hits++;
      const dmg = pelletDamage(weapon, bestHit.dist, bestHit.part, bestBot);
      applyDamage(bestBot, dmg, fighter, bestHit.part, weapon);
      hudHitmark(bestHit.part === 'head');
    }
  }
  const end = origin.clone().addScaledVector(dir, endDist);
  rig.addTracer(origin.clone().addScaledVector(dir, 0.7), end);
  if (endDist < 70) rig.addImpact(end);
  alertHearing(origin, fighter);
}

function alertHearing(at, shooter) {
  for (const f of match.fighters) {
    if (!f.alive || f.isPlayer || f.team === shooter.team) continue;
    const bot = bots.get(f);
    const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z);
    if (d < 20) bot.hear(at);
  }
}

let hitmarkTimer = null;
function hudHitmark(head) {
  sfx.hit();
  const h = document.getElementById('hitmarker');
  h.classList.add('on');
  clearTimeout(hitmarkTimer);
  hitmarkTimer = setTimeout(() => h.classList.remove('on'), 90);
}

function applyDamage(target, dmg, attacker, part, weapon) {
  if (!target.alive || match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  if (target.armor > 0 && part !== 'head') target.armor = Math.max(0, target.armor - dmg * 0.4);
  target.hp -= dmg;
  if (target.isPlayer) { hud.damageFlash(); sfx.hurt(); }
  if (target.hp <= 0) {
    target.hp = 0; target.alive = false; target.deaths++;
    attacker.kills++;
    attacker.money = Math.min(16000, attacker.money + 300);
    hud.killFeed(attacker, target, weapon.name.split(' ')[0], part === 'head');
    if (part === 'head') sfx.kill();
    if (target.hasCharge) target.hasCharge = false; // charge is lost with its carrier pre-plant
    checkRoundEnd();
  }
  if (target.isPlayer) hud.setVitals(target);
}

// Bot fire: a resolved roll instead of a physical ray (bots have no camera),
// weighted by range, target movement and the bot's own movement — the same
// accuracy economy the player lives under.
function botShoot(bot, weapon) {
  const f = bot.f;
  const target = bot.enemy;
  if (!target || !target.alive) return;
  const from = new THREE.Vector3(bot.pos.x, 1.35, bot.pos.z);
  const to = new THREE.Vector3(target.pos.x, 1.15, target.pos.z);
  const dist = from.distanceTo(to);
  if (segmentBlocked(from.x, from.z, to.x, to.z, 1.0)) return;
  alertHearing(from, f);
  sfx.shot('rifle');
  const targetMoving = target.isPlayer ? player.speed2D > 1 : true;
  let chance = 0.52 - dist * 0.006 - (targetMoving ? 0.1 : 0) + (target.isPlayer && player.crouch ? -0.08 : 0.06);
  chance = Math.max(0.08, Math.min(0.62, chance));
  const hit = Math.random() < chance;
  const jitter = hit ? 0.12 : 0.9;
  to.x += (Math.random() - 0.5) * jitter; to.y += (Math.random() - 0.5) * jitter * 0.5; to.z += (Math.random() - 0.5) * jitter;
  rig.addTracer(from, to, 0xff9a7a);
  if (hit) {
    const roll = Math.random();
    const part = roll < 0.12 ? 'head' : roll < 0.75 ? 'chest' : 'legs';
    applyDamage(target, pelletDamage(weapon, dist, part, target), f, part, weapon);
  }
}

// ---------- objective ----------
function tryPlant(bot, dt) {
  if (match.phase !== 'live' || match.charge.planted) return;
  plantingBy = bot.f;
  plantProgress += dt;
  if (plantProgress >= PLANT_TIME) completePlant(bot.f);
}
function tryDefuse(bot, dt) {
  if (!match.charge.planted) return;
  defusingBy = bot.f;
  defuseProgress += dt;
  if (defuseProgress >= (bot.f.kit ? DEFUSE_TIME / 2 : DEFUSE_TIME)) completeDefuse(bot.f);
}
function completePlant(planter) {
  match.charge.planted = true;
  match.charge.timer = CHARGE_TIME;
  match.charge.planter = planter;
  planter.hasCharge = false;
  match.phase = 'planted';
  plantProgress = 0;
  sfx.planted();
  hud.banner('CORE CHARGE PLANTED', `${Math.round(CHARGE_TIME)} seconds to detonation`, 2600);
  hud.feed(`<b>${planter.name}</b> planted the Core Charge`);
}
function completeDefuse(defuser) {
  match.charge.planted = false;
  sfx.planted();
  endRound(defuser.team, 'defuse', `${defuser.name} defused the Core Charge`);
}

// ---------- round flow ----------
function startRound() {
  resetRoundLoadouts(match);
  match.timer = ROUND_TIME;
  match.phase = 'buy';
  match.phaseTimer = BUY_TIME;
  plantProgress = 0; defuseProgress = 0; plantingBy = null; defusingBy = null;
  let wi = 0, bi = 0;
  for (const f of match.fighters) {
    const spawn = SPAWNS[f.team][f.team === TEAM.WARDEN ? wi++ : bi++];
    if (f.isPlayer) player.placeAt(spawn);
    else bots.get(f).spawnAt(spawn);
  }
  botBuyPhase();
  syncPlayerWeapon();
  hud.setTop(match); hud.setVitals(match.playerFighter); hud.setCombat(match.playerFighter);
  hud.banner(`ROUND ${match.round}`, match.playerFighter.team === match.attackTeam
    ? 'Plant the Core Charge at the vault' : 'Hold the vault — stop the plant', 2200);
  if (!SHOT) openBuy();
}

function botBuyPhase() {
  for (const f of match.fighters) {
    if (f.isPlayer) continue;
    // Simple policy: rifle when rich, SMG/scatter mid, armour first if poor.
    if (!f.weapons[1] && f.money >= 2700) { f.money -= 2700; giveWeapon(f, 'ember_rifle'); }
    else if (!f.weapons[1] && f.money >= 1500 && match.round > 1) { f.money -= 1500; giveWeapon(f, Math.random() < 0.5 ? 'scatter' : 'wasp'); }
    else if (!f.weapons[1] && f.money >= 3100) { f.money -= 3100; giveWeapon(f, 'longshot'); }
    if (f.armor < 100 && f.money >= 650) { f.money -= 650; f.armor = 100; }
    if (f.money >= 1200 && !f.helmet) { f.money -= 1000; f.helmet = true; f.armor = 100; }
    if (f.flash < 1 && f.money >= 400) { f.money -= 200; f.flash = 1; }
    if (f.team !== match.attackTeam && !f.kit && f.money >= 900) { f.money -= 400; f.kit = true; }
    f.current = f.weapons[1] || f.weapons[2];
  }
}

function endRound(winnerTeam, reason, note) {
  if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  match.phase = 'roundEnd';
  match.phaseTimer = 4.2;
  match.score[winnerTeam]++;
  awardRoundEnd(match, winnerTeam, reason);
  const playerWon = winnerTeam === match.playerFighter.team;
  if (reason === 'detonate') { sfx.explode(); hud.flashBlind(0.7); }
  playerWon ? sfx.roundWin() : sfx.roundLose();
  const titles = {
    elim: winnerTeam === TEAM.WARDEN ? 'Breachers eliminated' : 'Wardens eliminated',
    detonate: 'The vault is breached', defuse: 'Charge defused', time: 'Time — the vault holds',
  };
  hud.banner(playerWon ? 'ROUND WON' : 'ROUND LOST', note || titles[reason] || '', 3200);
  hud.setTop(match);
}

function checkRoundEnd() {
  if (match.phase !== 'live' && match.phase !== 'planted') return;
  const w = aliveCount(TEAM.WARDEN), b = aliveCount(TEAM.BREACH);
  if (match.charge.planted) {
    if (w === 0) endRound(TEAM.BREACH, 'elim');
    else if (b === 0) { /* defenders must still defuse or lose at detonation */ }
  } else {
    if (w === 0) endRound(TEAM.BREACH, 'elim');
    else if (b === 0) endRound(TEAM.WARDEN, 'elim');
  }
}

function endMatch() {
  match.phase = 'matchEnd';
  document.exitPointerLock?.();
  hud.matchEnd(match, match.score[match.playerFighter.team] >= WIN_SCORE);
}

// ---------- buying ----------
function openBuy() {
  hud.show('buy', true);
  document.exitPointerLock?.();
  renderBuy();
}
function closeBuy() {
  hud.show('buy', false);
  if (match.phase === 'buy' || match.phase === 'live' || match.phase === 'planted') player.requestLock();
}
function renderBuy() {
  hud.renderBuy(match.playerFighter, (id) => {
    const f = match.playerFighter;
    if (WEAPONS[id]) {
      if (f.money < WEAPONS[id].price) return;
      f.money -= WEAPONS[id].price;
      giveWeapon(f, id);
      syncPlayerWeapon();
    } else if (id === 'vest') { f.money -= GEAR.vest.price; f.armor = 100; }
    else if (id === 'helm') { f.money -= GEAR.helm.price; f.armor = 100; f.helmet = true; }
    else if (id === 'flash') { f.money -= GEAR.flash.price; f.flash = Math.min(2, f.flash + 1); }
    else if (id === 'kit') { f.money -= GEAR.kit.price; f.kit = true; }
    sfx.buy();
    hud.setVitals(f); hud.setCombat(f);
    renderBuy();
  });
}

function syncPlayerWeapon() {
  const f = match.playerFighter;
  rig.setWeapon(f.current);
  player.weaponSpeed = WEAPONS[f.current].moveSpeed;
  hud.setCombat(f);
}

// ---------- per-step simulation ----------
const botCtx = {
  get time() { return simTime; },
  enemiesOf,
  tryPlant, tryDefuse, botShoot,
};

function step(dt) {
  simTime += dt;
  const pf = match.playerFighter;
  if (match.phase === 'buy') {
    match.phaseTimer -= dt;
    if (match.phaseTimer <= 0) {
      match.phase = 'live';
      hud.show('buy', false);
      if (!SHOT) player.requestLock();
      hud.banner('FIGHT', '', 900);
    }
  } else if (match.phase === 'live') {
    match.timer -= dt;
    if (match.timer <= 0) endRound(TEAM.WARDEN, 'time');
  } else if (match.phase === 'planted') {
    match.charge.timer -= dt;
    if (Math.ceil(match.charge.timer) !== Math.ceil(match.charge.timer + dt)) sfx.plantBeep();
    if (match.charge.timer <= 0) endRound(match.attackTeam, 'detonate');
    checkRoundEnd();
  } else if (match.phase === 'roundEnd') {
    match.phaseTimer -= dt;
    if (match.phaseTimer <= 0) {
      if (match.score.warden >= WIN_SCORE || match.score.breach >= WIN_SCORE) endMatch();
      else { match.round++; startRound(); }
    }
  }

  const playing = ['buy', 'live', 'planted', 'roundEnd'].includes(match.phase);
  if (playing && pf.alive) {
    player.update(dt);
    // Player shooting
    const w = WEAPONS[pf.current];
    player.forward(_dir);
    _origin.copy(camera.position);
    rig.tryFire(pf, dt, player.spreadFactor(w), _dir, _origin);
    // Plant / defuse by holding E
    let objText = null, objFrac = 0;
    const dSite = Math.hypot(player.pos.x - SITE.x, player.pos.z - SITE.z);
    if (match.phase === 'live' && pf.hasCharge && dSite < SITE.radius) {
      objText = 'Hold E — planting the Core Charge';
      if (player.keys.has('KeyE')) {
        plantProgress += dt; objFrac = plantProgress / PLANT_TIME;
        if (plantProgress >= PLANT_TIME) completePlant(pf);
      } else plantProgress = Math.max(0, plantProgress - dt * 2);
    } else if (match.phase === 'planted' && pf.team !== match.attackTeam && dSite < 3) {
      objText = 'Hold E — defusing the Core Charge';
      const need = pf.kit ? DEFUSE_TIME / 2 : DEFUSE_TIME;
      if (player.keys.has('KeyE')) {
        defuseProgress += dt; objFrac = defuseProgress / need;
        if (defuseProgress >= need) completeDefuse(pf);
      } else defuseProgress = Math.max(0, defuseProgress - dt * 2);
    } else if (plantingBy && !plantingBy.isPlayer) { objText = `${plantingBy.name} is planting…`; objFrac = plantProgress / PLANT_TIME; }
    else if (defusingBy && !defusingBy.isPlayer) { objText = `${defusingBy.name} is defusing…`; objFrac = defuseProgress / DEFUSE_TIME; }
    hud.objective(objText, objFrac);
    if (plantingBy && plantingBy !== pf) plantProgress = Math.max(0, plantProgress); // bots drive their own progress
    plantingBy = null; defusingBy = null;
  }
  if (playing) {
    for (const bot of bots.values()) bot.update(dt, match, botCtx);
  }
  // Flash pellets resolve
  for (let i = flashEvents.length - 1; i >= 0; i--) {
    flashEvents[i].t -= dt;
    if (flashEvents[i].t <= 0) { resolveFlash(flashEvents[i].at); flashEvents.splice(i, 1); }
  }
  rig.update(dt);
  hud.setTop(match);
  if (pf.alive) { hud.setVitals(pf); hud.setCombat(pf); }
}

function resolveFlash(at) {
  sfx.flash();
  for (const f of match.fighters) {
    if (!f.alive) continue;
    const d = Math.hypot(f.pos.x - at.x, f.pos.z - at.z);
    if (d > 15) continue;
    if (segmentBlocked(at.x, at.z, f.pos.x, f.pos.z, 1.0)) continue;
    if (f.isPlayer) {
      player.forward(_dir);
      const toBurst = _origin.set(at.x - player.pos.x, 0, at.z - player.pos.z).normalize();
      const facing = _dir.x * toBurst.x + _dir.z * toBurst.z;
      hud.flashBlind(Math.max(0, facing) * (1 - d / 18));
    } else {
      const bot = bots.get(f);
      bot.enemy = null; bot.lastSeen = null;
      bot.state = 'hold'; bot.holdUntil = simTime + 2.4;
    }
  }
}

function throwFlash() {
  const pf = match.playerFighter;
  if (pf.flash <= 0 || !pf.alive) return;
  pf.flash--;
  player.forward(_dir);
  const at = new THREE.Vector3(
    player.pos.x + _dir.x * 8, 1.4, player.pos.z + _dir.z * 8);
  flashEvents.push({ at, t: 0.85 });
  hud.setCombat(pf);
}

// ---------- input ----------
document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && player.locked) rig.triggerHeld = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) rig.triggerHeld = false; });
document.addEventListener('keydown', (e) => {
  if (!match) return;
  const pf = match.playerFighter;
  if (e.code === 'KeyR') rig.startReload(pf);
  if (e.code === 'Digit1' && pf.weapons[1]) { pf.current = pf.weapons[1]; syncPlayerWeapon(); }
  if (e.code === 'Digit2' && pf.weapons[2]) { pf.current = pf.weapons[2]; syncPlayerWeapon(); }
  if (e.code === 'Digit3' || e.code === 'KeyG') throwFlash();
  if (e.code === 'KeyB' && match.phase === 'buy') {
    el2('buy').hidden ? openBuy() : closeBuy();
  }
});
function el2(id) { return document.getElementById(id); }

document.getElementById('play').addEventListener('click', () => startGame(TEAM.WARDEN));
document.getElementById('play-attack').addEventListener('click', () => startGame(TEAM.BREACH));
document.getElementById('buy-done').addEventListener('click', closeBuy);
document.getElementById('again').addEventListener('click', () => {
  hud.show('matchend', false);
  startGame(match.playerFighter.team);
});
renderer.domElement.addEventListener('click', () => {
  if (match && !player.locked && el2('buy').hidden && el2('menu').hidden) player.requestLock();
});

function startGame(team) {
  ensureAudio();
  setupMatch(team);
  hud.show('menu', false);
  match.round = 1;
  match.score = { warden: 0, breach: 0 };
  startRound();
}

// ---------- screenshot staging (?shot=...) ----------
if (SHOT) {
  hud.show('menu', false);
  setupMatch(TEAM.WARDEN);
  if (SHOT === 'buy') {
    startRound();
    hud.banner('', '', 1);
    openBuy();
    player.pos.set(-24, 0, -6); player.yaw = Math.PI / 2 + 0.4;
  } else if (SHOT === 'combat') {
    startRound();
    match.phase = 'live'; match.timer = 63;
    hud.show('buy', false);
    const pf = match.playerFighter;
    pf.money = 4350; giveWeapon(pf, 'ember_rifle'); pf.armor = 100; syncPlayerWeapon();
    player.pos.set(0, 0, -10.5); player.yaw = -1.25; player.pitch = -0.02;
    // Stage two Breachers pushing the north lane into view.
    const foes = match.fighters.filter(f => f.team === TEAM.BREACH);
    foes[0].pos.set(8, 0, -13.5); foes[1].pos.set(11.5, 0, -9);
    foes[2].pos.set(-14, 0, 12); foes[3].pos.set(18, 0, 8); foes[4].pos.set(-20, 0, -2);
    hud.feed('<b>You</b> ▸ EMBERLINE <b>Fable</b>');
  } else if (SHOT === 'end') {
    startRound();
    match.phase = 'live'; hud.show('buy', false);
    match.score = { warden: 5, breach: 3 }; match.round = 9;
    player.pos.set(13, 0, 7); player.yaw = -1.0; player.pitch = -0.03;
    const pf = match.playerFighter;
    giveWeapon(pf, 'ember_rifle'); pf.armor = 100; pf.money = 6100; syncPlayerWeapon();
    hud.banner('ROUND WON', 'Breachers eliminated — Wardens 5 · Breachers 3', 60000);
  } else { // menu
    hud.show('menu', true);
    setupMatch(TEAM.WARDEN);
    match.phase = 'menu';
    player.pos.set(-16, 0, 10); player.yaw = -2.4; player.pitch = -0.05;
    let wi = 0, bi = 0;
    for (const f of match.fighters) {
      if (f.isPlayer) continue;
      const s = SPAWNS[f.team][f.team === TEAM.WARDEN ? wi++ : bi++];
      bots.get(f).spawnAt(s);
    }
  }
  window.__shotReady = true;
}

// ---------- main loop: fixed-step sim, render every frame ----------
let last = performance.now();
let acc = 0;
const SIM_DT = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (match && match.phase !== 'menu') {
    acc += dt;
    while (acc >= SIM_DT) { step(SIM_DT); acc -= SIM_DT; }
  } else if (match) {
    // Menu backdrop: idle bots in place, camera drifts slowly.
    player.yaw += dt * 0.02;
    player.update(0);
    camera.position.set(player.pos.x, 1.62, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
