// state.js — one home for match state, weapon definitions and the economy.
// Everything mutable about a match lives in the object from createMatch();
// modules read and write it, nobody keeps a private copy of score or money.

export const TEAM = { WARDEN: 'warden', BREACH: 'breach' };
export const TEAM_NAME = { warden: 'Wardens', breach: 'Breachers' };
export const WIN_SCORE = 7;
export const ROUND_TIME = 100;      // seconds of live round
export const BUY_TIME = 14;         // seconds of buy phase
export const PLANT_TIME = 3.2;      // hold E to plant the Core Charge
export const DEFUSE_TIME = 5.0;     // hold E to defuse (2.5 with kit)
export const CHARGE_TIME = 38;      // seconds from plant to detonation

// Weapon table. damage is per pellet at point blank; headshot x4, chest x1,
// legs x0.75. falloff is damage kept per metre past rangeStart. spread is in
// radians for a standing, still shooter; movement and air multiply it.
export const WEAPONS = {
  kestrel: { id: 'kestrel', name: 'KESTREL-9 SIDEARM', slot: 2, price: 0, damage: 26, headMult: 4,
    rpm: 340, mag: 12, reserve: Infinity, reload: 1.4, auto: false, pellets: 1,
    spreadStill: 0.006, spreadMove: 0.045, recoil: 0.011, rangeStart: 14, falloff: 0.985, moveSpeed: 1.0 },
  ember_rifle: { id: 'ember_rifle', name: 'EMBERLINE RIFLE', slot: 1, price: 2700, damage: 33, headMult: 4,
    rpm: 600, mag: 30, reserve: 90, reload: 2.3, auto: true, pellets: 1,
    spreadStill: 0.004, spreadMove: 0.055, recoil: 0.016, rangeStart: 22, falloff: 0.995, moveSpeed: 0.94 },
  longshot: { id: 'longshot', name: 'LONGSHOT DMR', slot: 1, price: 3100, damage: 72, headMult: 2.6,
    rpm: 150, mag: 10, reserve: 40, reload: 2.6, auto: false, pellets: 1,
    spreadStill: 0.0012, spreadMove: 0.07, recoil: 0.045, rangeStart: 40, falloff: 0.998, moveSpeed: 0.9 },
  scatter: { id: 'scatter', name: 'SCATTERJACK', slot: 1, price: 1500, damage: 13, headMult: 1.6,
    rpm: 68, mag: 6, reserve: 30, reload: 3.0, auto: false, pellets: 8,
    spreadStill: 0.035, spreadMove: 0.06, recoil: 0.06, rangeStart: 6, falloff: 0.93, moveSpeed: 0.96 },
  wasp: { id: 'wasp', name: 'WASP SMG', slot: 1, price: 1400, damage: 21, headMult: 2.2,
    rpm: 880, mag: 32, reserve: 96, reload: 1.9, auto: true, pellets: 1,
    spreadStill: 0.012, spreadMove: 0.035, recoil: 0.009, rangeStart: 12, falloff: 0.982, moveSpeed: 1.02 },
};
export const GEAR = {
  vest: { id: 'vest', name: 'Foundry Vest', desc: 'Body armour — halves chest damage', price: 650 },
  helm: { id: 'helm', name: 'Vest + Cowl', desc: 'Armour and head protection', price: 1000 },
  flash: { id: 'flash', name: 'Flash Pellet', desc: 'Blinds anyone looking at the burst (G)', price: 200 },
  kit: { id: 'kit', name: 'Defuse Kit', desc: 'Defuse the Core Charge twice as fast', price: 400 },
};

export function createFighter(name, team, isPlayer = false) {
  return {
    name, team, isPlayer, alive: true, hp: 100, armor: 0, helmet: false,
    money: 800, kills: 0, deaths: 0,
    weapons: { 1: null, 2: 'kestrel' }, // slot -> weapon id
    ammo: { kestrel: { mag: 12, reserve: Infinity } },
    current: 'kestrel', flash: 0, kit: false, hasCharge: false,
    pos: null, // THREE.Vector3 set by the world
  };
}

export function giveWeapon(f, id) {
  const w = WEAPONS[id];
  f.weapons[w.slot] = id;
  f.ammo[id] = { mag: w.mag, reserve: w.reserve };
  f.current = id;
}

export function createMatch(playerTeam) {
  return {
    phase: 'menu', // menu | buy | live | planted | roundEnd | matchEnd
    round: 1, score: { warden: 0, breach: 0 },
    timer: ROUND_TIME, phaseTimer: 0,
    playerTeam, attackTeam: TEAM.BREACH, // Breachers plant; Wardens defend
    charge: { planted: false, timer: 0, planter: null },
    fighters: [], feed: [], winner: null, roundWinner: null,
    stats: { shots: 0, hits: 0 },
  };
}

// Round-end economy: win bonus, loss bonus that grows with a losing streak,
// plant and kill rewards — the loop that makes the buy menu matter.
export function awardRoundEnd(match, winnerTeam, reason) {
  for (const f of match.fighters) {
    if (f.team === winnerTeam) f.money += reason === 'detonate' || reason === 'defuse' ? 3000 : 2700;
    else f.money += 1900;
    if (reason === 'plant' || reason === 'detonate') { /* planter paid below */ }
    f.money = Math.min(16000, f.money);
  }
  if (match.charge.planter && match.charge.planter.team === winnerTeam) {
    match.charge.planter.money = Math.min(16000, match.charge.planter.money + 300);
  }
}

export function resetRoundLoadouts(match) {
  for (const f of match.fighters) {
    f.alive = true; f.hp = 100; f.hasCharge = false;
    // Dead last round or a fresh match: back to the sidearm and a stipend floor.
    if (!f.weapons[1] && f.deaths > 0) { /* keep pistol only */ }
    for (const id of Object.keys(f.ammo)) {
      const w = WEAPONS[id];
      f.ammo[id] = { mag: w.mag, reserve: w.reserve };
    }
    f.current = f.weapons[1] || f.weapons[2];
    if (f.team === match.attackTeam && f.isPlayer) f.hasCharge = true;
  }
  // The charge goes to one attacker: the player if attacking, else a bot.
  const attackers = match.fighters.filter(f => f.team === match.attackTeam && f.alive);
  if (!attackers.some(f => f.hasCharge) && attackers.length) {
    const carrier = attackers.find(f => f.isPlayer) || attackers[0];
    carrier.hasCharge = true;
  }
  match.charge = { planted: false, timer: 0, planter: null };
}
