// hud.js — every DOM readout: vitals, ammo, money, timer, score, kill feed,
// banners, the objective/plant bar, damage and flash overlays, and the buy
// menu. It only renders state; main.js owns the state.

import { WEAPONS, GEAR, TEAM_NAME } from './state.js';
import { sfx } from './audio.js';

const el = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.feedEl = el('feed');
    this.bannerTimer = null;
  }

  setVitals(f) {
    el('hptext').textContent = Math.max(0, Math.ceil(f.hp));
    el('hpfill').style.width = Math.max(0, f.hp) + '%';
    el('hpfill').style.background = f.hp > 50 ? 'var(--good)' : f.hp > 25 ? 'var(--ember)' : 'var(--bad)';
    el('armortext').textContent = f.armor > 0 ? `🛡 ${Math.ceil(f.armor)}${f.helmet ? ' + cowl' : ''}` : '';
  }

  setCombat(f) {
    const w = WEAPONS[f.current];
    const ammo = f.ammo[f.current];
    el('weaponname').textContent = w.name + (f.hasCharge ? ' · CARRYING CORE CHARGE' : '');
    el('ammo').textContent = ammo.mag;
    el('ammo').className = ammo.mag <= Math.ceil(w.mag * 0.25) ? 'low' : '';
    el('reserve').textContent = '/ ' + (ammo.reserve === Infinity ? '∞' : ammo.reserve);
    el('money').textContent = '$' + f.money;
  }

  setTop(match) {
    el('score-w').textContent = match.score.warden;
    el('score-b').textContent = match.score.breach;
    el('roundlabel').textContent = 'ROUND ' + match.round;
    const t = Math.max(0, Math.ceil(match.phase === 'planted' ? match.charge.timer : match.timer));
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    const timerEl = el('timer');
    timerEl.textContent = `${mm}:${ss}`;
    timerEl.className = t <= 15 || match.phase === 'planted' ? 'low' : '';
    el('roundlabel2').textContent = match.phase === 'planted' ? 'CHARGE PLANTED' : '';
  }

  feed(html) {
    const row = document.createElement('div');
    row.innerHTML = html;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild.remove();
    setTimeout(() => { row.style.opacity = '0.35'; }, 4200);
  }

  killFeed(killer, victim, weaponName, headshot) {
    const kc = killer.team === 'warden' ? 'var(--ward)' : 'var(--breach)';
    const vc = victim.team === 'warden' ? 'var(--ward)' : 'var(--breach)';
    this.feed(`<b style="color:${kc}">${killer.name}</b> ${headshot ? '⌖' : '▸'} ${weaponName} <b style="color:${vc}">${victim.name}</b>`);
  }

  banner(title, sub, ms = 2400) {
    el('banner-title').textContent = title;
    el('banner-sub').textContent = sub || '';
    el('banner').classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el('banner').classList.remove('on'), ms);
  }

  objective(text, frac) {
    const box = el('objective');
    if (text == null) { box.hidden = true; return; }
    box.hidden = false;
    el('objective-text').textContent = text;
    el('plantfill').style.width = Math.round((frac || 0) * 100) + '%';
  }

  damageFlash() {
    const d = el('damaged');
    d.style.opacity = '1';
    setTimeout(() => { d.style.opacity = '0'; }, 130);
  }

  flashBlind(strength) { // strength 0..1 of the white-out
    const f = el('flashfx');
    f.style.transition = 'none';
    f.style.opacity = String(Math.min(1, strength));
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 2.4s linear';
      f.style.opacity = '0';
    });
  }

  show(id, on) { el(id).hidden = !on; }

  // Build the buy grid for the player's fighter; onBuy(id) handles payment.
  renderBuy(f, onBuy) {
    el('buymoney').textContent = '$' + f.money;
    const grid = el('buygrid');
    grid.innerHTML = '';
    const items = [];
    for (const w of Object.values(WEAPONS)) {
      if (w.id === 'kestrel') continue;
      const owned = Object.values(f.weapons).includes(w.id);
      items.push({ id: w.id, nm: w.name, ds: `DMG ${w.damage} · ${w.mag} rounds · ${w.auto ? 'auto' : 'semi'}`, pr: w.price, owned });
    }
    items.push({ id: 'vest', nm: GEAR.vest.name, ds: GEAR.vest.desc, pr: GEAR.vest.price, owned: f.armor >= 100 });
    items.push({ id: 'helm', nm: GEAR.helm.name, ds: GEAR.helm.desc, pr: GEAR.helm.price, owned: f.helmet });
    items.push({ id: 'flash', nm: GEAR.flash.name, ds: GEAR.flash.desc, pr: GEAR.flash.price, owned: f.flash >= 2 });
    items.push({ id: 'kit', nm: GEAR.kit.name, ds: GEAR.kit.desc, pr: GEAR.kit.price, owned: f.kit });
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'buyitem' + (it.owned ? ' owned' : f.money < it.pr ? ' cant' : '');
      b.innerHTML = `<div class="nm">${it.nm}${it.owned ? ' ✓' : ''}</div><div class="ds">${it.ds}</div><div class="pr">$${it.pr}</div>`;
      if (!it.owned && f.money >= it.pr) b.addEventListener('click', () => { onBuy(it.id); });
      grid.appendChild(b);
    }
  }

  matchEnd(match, playerWon) {
    el('end-title').textContent = playerWon ? '🏆 The vault is yours' : 'The vault falls';
    el('end-copy').textContent =
      `${TEAM_NAME.warden} ${match.score.warden} — ${match.score.breach} ${TEAM_NAME.breach}. ` +
      `You finished with ${match.playerFighter.kills} eliminations and ${match.playerFighter.deaths} deaths.`;
    this.show('matchend', true);
  }
}
