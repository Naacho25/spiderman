// ============================================================================
// Wiring de DOM: menú, selector de skin, panel de logros/instrucciones, toasts,
// HUD de pausa/inicio/game-over. Ninguna física ni estado de partida vive acá —
// todo eso está en state.js. Este módulo solo refleja ese estado en pantalla y
// traduce clicks en llamadas a funciones de state.js.
// ============================================================================

import * as state from './state.js';

export function initUI({ onPlay }){
  renderSkinPicker();
  state.loadStats();
  renderAchievements();

  state.setAchievementUnlockedHandler(queueAchievementToast);
  state.setShowMenuHandler(renderSkinPicker);

  document.getElementById('achievementsBtn').addEventListener('click', () => {
    renderAchievements();
    document.getElementById('achievementsOverlay').classList.add('show');
  });
  document.getElementById('closeAchievements').addEventListener('click', () => {
    document.getElementById('achievementsOverlay').classList.remove('show');
  });
  document.getElementById('instructionsBtn').addEventListener('click', () => {
    document.getElementById('instructionsOverlay').classList.add('show');
  });
  document.getElementById('closeInstructions').addEventListener('click', () => {
    document.getElementById('instructionsOverlay').classList.remove('show');
  });

  document.getElementById('restartBtn').addEventListener('click', state.restart);
  document.getElementById('menuFromDeathBtn').addEventListener('click', () => {
    document.getElementById('overlay').classList.remove('show');
    state.showMenu();
  });
  document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startOverlay').style.display = 'none';
    document.getElementById('hud').style.display = 'block';
    document.getElementById('hint').style.display = 'block';
    document.getElementById('pauseBtn').style.display = 'flex';
    state.initGame();
    onPlay();
  });

  document.getElementById('pauseBtn').addEventListener('click', state.togglePause);
  document.getElementById('resumeBtn').addEventListener('click', state.togglePause);
  document.getElementById('restartFromPauseBtn').addEventListener('click', () => {
    document.getElementById('pauseOverlay').classList.remove('show');
    state.restart();
  });
  document.getElementById('menuBtn').addEventListener('click', state.showMenu);
}

// ---------- HUD por-frame (mensajes de pickup flotantes) ----------
export function updateHud(){
  const el = document.getElementById('pickupMsg');
  if (!el) return;
  if (state.pickupMsg){
    el.textContent = state.pickupMsg.text;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ---------- selector de skin ----------
function renderSkinPicker(){
  const el = document.getElementById('skinPicker');
  el.innerHTML = '';
  state.SKINS.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'skin-item';
    const swatch = document.createElement('div');
    swatch.className = 'skin-swatch' + (i === state.selectedSkin ? ' selected' : '');
    swatch.style.background = `linear-gradient(135deg, ${s.torso} 55%, ${s.legs} 55%)`;
    swatch.addEventListener('click', () => { state.setSelectedSkin(i); renderSkinPicker(); });
    const label = document.createElement('div');
    label.className = 'skin-label' + (i === state.selectedSkin ? ' selected' : '');
    label.textContent = s.name;
    item.appendChild(swatch);
    item.appendChild(label);
    el.appendChild(item);
  });
}

// ---------- logros ----------
const ACH_CATEGORIES = {
  distancia: '📏 Distancia', altura: '🪂 Altura', powerups: '✨ Power-ups',
  enemigos: '🕵️ Enemigos esquivados', derrotas: '⚔️ Enemigos derrotados',
  edificios: '🏙️ Edificios de Nueva York', ciclo: '🌇 Ciclo del día',
  extra: '🌟 Especiales'
};

function renderAchievements(){
  const list = document.getElementById('achievementsList');
  if (!list) return;
  list.innerHTML = '';
  Object.keys(ACH_CATEGORIES).forEach(catKey => {
    const group = document.createElement('div');
    group.className = 'ach-group';
    const h = document.createElement('h3');
    h.textContent = ACH_CATEGORIES[catKey];
    group.appendChild(h);
    state.ACHIEVEMENTS.filter(a => a.category === catKey).forEach(a => {
      const unlocked = a.check(state.stats);
      const row = document.createElement('div');
      row.className = 'ach-row' + (unlocked ? ' unlocked' : '');
      row.innerHTML =
        '<span class="ach-icon">' + (unlocked ? '🏅' : '🔒') + '</span>' +
        '<div><div class="ach-name">' + a.name + '</div><div class="ach-desc">' + a.desc + '</div></div>';
      group.appendChild(row);
    });
    list.appendChild(group);
  });
}

let achievementToastQueue = [];
let achievementToastBusy = false;
function queueAchievementToast(a){
  achievementToastQueue.push(a);
  processAchievementToastQueue();
}
function processAchievementToastQueue(){
  if (achievementToastBusy || achievementToastQueue.length === 0) return;
  achievementToastBusy = true;
  const a = achievementToastQueue.shift();
  const el = document.getElementById('achievementToast');
  el.innerHTML = '🏅 Logro desbloqueado: <strong>' + a.name + '</strong>';
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { achievementToastBusy = false; processAchievementToastQueue(); }, 300);
  }, 2600);
}
