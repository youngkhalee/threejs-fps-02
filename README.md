# Ember Vault

An original round-based tactical FPS built with three.js 0.187.0 — no build
step, no network requests, single-player against bots.

The Breachers want the vault core. Your Warden squad holds the foundry.
Plant the **Core Charge** on the vault plinth (or stop theirs), win rounds
by elimination or the objective, earn money, and buy rifles, a DMR, a
scattergun, an SMG, armour, flash pellets and a defuse kit between rounds.
First to 7 rounds. Accuracy counts more than speed: spread blooms hard
while moving or airborne, and crouching steady pays.

## Play

```sh
node serve.ts   # then open http://localhost:8080
```

WASD move · mouse look · click fire · R reload · 1/2 weapons · Ctrl crouch ·
Shift walk · Space jump · E plant/defuse (hold) · G flash pellet · B buy menu

## Layout

- `game/index.html` — page, HUD and menus
- `game/src/main.js` — match flow and fixed-step simulation
- `game/src/state.js` — weapon table, economy, match state
- `game/src/map.js` — the Foundry: three lanes, collision, waypoint graph
- `game/src/bots.js` — bot perception, routes, objective play
- `game/src/player.js` — first-person controller
- `game/src/weapons.js` — viewmodels, spread/recoil, damage model
- `game/src/hud.js`, `game/src/audio.js` — readouts and synthesised sound
- `main.ts` — the hand-in program; writes the judge's dossier via
  `vendor/makefun-threejs.ts`

SPDX-License-Identifier: MIT
