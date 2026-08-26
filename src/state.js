// ============================================================================
// Estado y física del juego — PORTADO VERBATIM desde el index.html 2D original.
// Ningún número de esta física/progresión debe cambiar: fue ajustado en muchas
// rondas de feedback ("que se sienta bien"). Este archivo es puro estado/lógica,
// no sabe nada de Three.js ni de cómo se dibuja nada — eso vive en world3d.js,
// hero.js, city.js, enemies3d.js, vfx.js.
//
// El único punto de contacto con el render 3D es `setRaycaster()`: en vez del
// viejo mapeo trivial screen->world (`x: clientX + cameraX, y: clientY`), el
// input ahora se resuelve con un raycast 3D contra el plano z=0 (ver world3d.js).
// Matemáticamente ese raycast reproduce el mismo mapeo exacto para todo lo que
// esté en z=0 — ver Fase 0 del plan.
// ============================================================================

import { DAY_CYCLE_FRAMES } from './skystate.js';

export const canvas = document.getElementById('game');

// ---------- tamaño lógico del mundo (= tamaño de viewport en CSS px) ----------
export let W, H;
function resize(){
  // en algunos hosts el layout todavía no corrió cuando este script se evalúa
  // (innerWidth/innerHeight en 0) — no dejar que el mundo quede a tamaño cero
  W = innerWidth || document.documentElement.clientWidth || 1280;
  H = innerHeight || document.documentElement.clientHeight || 720;
}
resize();
addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (!document.hidden) resize(); });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('selectstart', e => e.preventDefault());

// ---------- constantes de física (NO TOCAR) ----------
export const GRAVITY = 0.36;
export const DAMPING = 0.997;
export const AIR_CONTROL = 0.34;
export const MAX_WEB = 520;
export const JUMP_VY = -12;
export const AUTO_SHOOT_DURATION = 300; // ~5s a 60fps
const FAST_SWING_FRAMES = 20;
const MIN_FLOW_DISTANCE = 35;
const FLOW_BOOST_PER_COMBO = 3.4;
const BASE_RELEASE_LIFT = 2.2;
const MAX_FLOW_COMBO = 6;
const AUTO_SHOOT_COOLDOWN = 24;
const ROPE_ADJUST_RANGE = 55;

// ---------- estado global de partida ----------
export let groundY, cameraX, buildings, powerUps, enemies, climbers, sandHands,
  rhinos, scorpions, poisonBolts, cranes, helicopters, webShots, player, web, keys,
  score, best = 0, running = false, gameOver = false;
export let startBuilding, canLand, pickupMsg = null, pumpVel = 0, sessionMaxHeightPx = 0,
  paused = false, progressM = 0;
export let deathTitle = '💥 Tocaste el piso';
export let elapsedFrames = 0;
export let missMarker = null, webThrow = null;
let nextHeliAt = 0;
let lastCycleIndex = 0;

export function setRunning(v){ running = v; }

// ---------- skins ----------
export const SKINS = [
  { id:'classic', name:'Clásico',  torso:'#e0262c', accent:'#1b3fa0', legs:'#1b3fa0', mask:'#141824', eyeGlow:false },
  { id:'noir',    name:'Nocturno', torso:'#202024', accent:'#4a4a54', legs:'#111114', mask:'#0a0a0c', eyeGlow:true,  eyeColor:'#ffffff' },
  { id:'tech',    name:'Dorado',   torso:'#a8262c', accent:'#d4af37', legs:'#2b2b2b', mask:'#5c1418', eyeGlow:true,  eyeColor:'#ffd76a' },
  { id:'future',  name:'Blanco',   torso:'#e9e9ec', accent:'#c0272d', legs:'#c0272d', mask:'#1c1c22', eyeGlow:false },
  { id:'stealth', name:'Sigilo',   torso:'#1c2b45', accent:'#2f4a73', legs:'#0f1a2b', mask:'#0c1420', eyeGlow:true,  eyeColor:'#4dd0e1' },
];
export let selectedSkin = 0;
export function setSelectedSkin(i){ selectedSkin = i; }

// ---------- logros (persistidos entre partidas) ----------
export let stats = {
  bestDistance: 0, bestHeight: 0, totalPowerUps: 0,
  totalEnemiesAvoided: 0, extraLifeUses: 0, skinsUsed: [],
  enemiesDefeated: 0, totalDayCycles: 0, enemyTypesSeen: [],
  landmarkCounts: { empire: 0, wtc: 0, times: 0 }, unlockedIds: []
};

export const ACHIEVEMENTS = [
  { id:'dist_800', category:'distancia', name:'Corredor urbano', desc:'Recorré 800 m en una partida', check: s => s.bestDistance >= 800 },
  { id:'dist_2500', category:'distancia', name:'Maratón de azotea', desc:'Recorré 2500 m en una partida', check: s => s.bestDistance >= 2500 },
  { id:'dist_6000', category:'distancia', name:'Leyenda de la ciudad', desc:'Recorré 6000 m en una partida', check: s => s.bestDistance >= 6000 },

  { id:'height_50', category:'altura', name:'Primeros pasos en el aire', desc:'Llegá a 50 m de altura', check: s => s.bestHeight >= 50 },
  { id:'height_110', category:'altura', name:'Vértigo', desc:'Llegá a 110 m de altura', check: s => s.bestHeight >= 110 },
  { id:'height_190', category:'altura', name:'Rozando las nubes', desc:'Llegá a 190 m de altura', check: s => s.bestHeight >= 190 },

  { id:'power_10', category:'powerups', name:'Primeros poderes', desc:'Agarrá 10 power-ups en total', check: s => s.totalPowerUps >= 10 },
  { id:'power_50', category:'powerups', name:'Coleccionista', desc:'Agarrá 50 power-ups en total', check: s => s.totalPowerUps >= 50 },
  { id:'power_150', category:'powerups', name:'Acumulador experto', desc:'Agarrá 150 power-ups en total', check: s => s.totalPowerUps >= 150 },

  { id:'dodge_8', category:'enemigos', name:'Esquivador novato', desc:'Esquivá o derrotá 8 enemigos', check: s => s.totalEnemiesAvoided >= 8 },
  { id:'dodge_30', category:'enemigos', name:'Reflejos arácnidos', desc:'Esquivá o derrotá 30 enemigos', check: s => s.totalEnemiesAvoided >= 30 },
  { id:'dodge_80', category:'enemigos', name:'Maestro esquivador', desc:'Esquivá o derrotá 80 enemigos', check: s => s.totalEnemiesAvoided >= 80 },
  { id:'variety_all', category:'enemigos', name:'Los conocés a todos', desc:'Cruzate con los 5 tipos de enemigo distintos', check: s => (s.enemyTypesSeen||[]).length >= 5 },

  { id:'defeat_1', category:'derrotas', name:'Primera victoria', desc:'Derrotá a tu primer enemigo', check: s => s.enemiesDefeated >= 1 },
  { id:'defeat_10', category:'derrotas', name:'Vengador urbano', desc:'Derrotá a 10 enemigos en total', check: s => s.enemiesDefeated >= 10 },
  { id:'defeat_30', category:'derrotas', name:'Terror de los villanos', desc:'Derrotá a 30 enemigos en total', check: s => s.enemiesDefeated >= 30 },
  { id:'defeat_75', category:'derrotas', name:'Francotirador', desc:'Derrotá a 75 enemigos en total', check: s => s.enemiesDefeated >= 75 },
  { id:'defeat_150', category:'derrotas', name:'Leyenda de la telaraña', desc:'Derrotá a 150 enemigos en total', check: s => s.enemiesDefeated >= 150 },

  { id:'landmark_empire', category:'edificios', name:'Rascacielos icónico', desc:'Pasá cerca del Empire State', check: s => (s.landmarkCounts && s.landmarkCounts.empire || 0) >= 1 },
  { id:'landmark_wtc', category:'edificios', name:'Torre de vidrio', desc:'Pasá cerca del One World Trade Center', check: s => (s.landmarkCounts && s.landmarkCounts.wtc || 0) >= 1 },
  { id:'landmark_times', category:'edificios', name:'Luces de neón', desc:'Pasá cerca de Times Square', check: s => (s.landmarkCounts && s.landmarkCounts.times || 0) >= 1 },
  { id:'landmark_all', category:'edificios', name:'Turista arácnido', desc:'Encontrá los 3 edificios temáticos al menos una vez', check: s => {
      const l = s.landmarkCounts || {};
      return (l.empire||0) >= 1 && (l.wtc||0) >= 1 && (l.times||0) >= 1;
    } },
  { id:'landmark_20', category:'edificios', name:'Guía turística', desc:'Cruzate con 20 edificios temáticos en total', check: s => {
      const l = s.landmarkCounts || {};
      return (l.empire||0) + (l.wtc||0) + (l.times||0) >= 20;
    } },

  { id:'day_1', category:'ciclo', name:'Un día en la ciudad', desc:'Completá 1 ciclo del día entero', check: s => s.totalDayCycles >= 1 },
  { id:'day_5', category:'ciclo', name:'Varios amaneceres', desc:'Completá 5 ciclos del día en total', check: s => s.totalDayCycles >= 5 },
  { id:'day_15', category:'ciclo', name:'El vigilante nocturno', desc:'Completá 15 ciclos del día en total', check: s => s.totalDayCycles >= 15 },

  { id:'skins_all', category:'extra', name:'Guardarropa completo', desc:'Probá los 5 trajes disponibles', check: s => (s.skinsUsed||[]).length >= SKINS.length },
  { id:'extralife', category:'extra', name:'Segunda oportunidad', desc:'Usá un rebote de vida extra', check: s => s.extraLifeUses >= 1 },
];

// ui.js engancha acá para mostrar el toast — state.js no sabe nada del DOM del toast
let onAchievementUnlocked = () => {};
export function setAchievementUnlockedHandler(fn){ onAchievementUnlocked = fn; }

export function loadStats(){
  try {
    const raw = localStorage.getItem('trepamuros_stats');
    if (raw) stats = Object.assign(stats, JSON.parse(raw));
  } catch (e) { /* almacenamiento local no disponible en este entorno */ }
  if (!stats.unlockedIds) stats.unlockedIds = [];
  // sincroniza en silencio: no avisar por logros que ya estaban cumplidos antes de esta versión
  for (const a of ACHIEVEMENTS){
    if (!stats.unlockedIds.includes(a.id) && a.check(stats)) stats.unlockedIds.push(a.id);
  }
}
export function saveStats(){
  checkNewAchievements();
  try { localStorage.setItem('trepamuros_stats', JSON.stringify(stats)); }
  catch (e) { console.error('No se pudo guardar el progreso', e); }
}
function checkNewAchievements(){
  if (!stats.unlockedIds) stats.unlockedIds = [];
  for (const a of ACHIEVEMENTS){
    if (!stats.unlockedIds.includes(a.id) && a.check(stats)){
      stats.unlockedIds.push(a.id);
      onAchievementUnlocked(a);
    }
  }
}

// cada tanto, en vez de un edificio genérico, sale uno temático de Nueva York
function makeBuilding(x, baseWidth, baseHeight){
  const b = { x, width: baseWidth, height: baseHeight, landmark: null };
  if (progressM < DIFF.landmarkStart) return b;
  const roll = Math.random();
  if (roll < 0.035){
    b.landmark = 'empire';
    b.width = 130 + Math.random()*30;
    b.height = H * (0.74 + Math.random()*0.14);
  } else if (roll < 0.06){
    b.landmark = 'wtc';
    b.width = 70 + Math.random()*30;
    b.height = H * (0.84 + Math.random()*0.1);
  } else if (roll < 0.10){
    b.landmark = 'times';
    b.width = 230 + Math.random()*110;
    b.height = H * (0.32 + Math.random()*0.16);
  }
  return b;
}

export function initGame(){
  paused = false;
  groundY = H - 70;
  cameraX = 0;
  score = 0;
  progressM = 0;
  sessionMaxHeightPx = 0;
  deathTitle = '💥 Tocaste el piso';
  elapsedFrames = 0;
  lastCycleIndex = 0;
  buildings = [];
  powerUps = [];
  enemies = [];
  climbers = [];
  sandHands = [];
  rhinos = [];
  scorpions = [];
  poisonBolts = [];
  cranes = [];
  helicopters = [];
  webShots = [];
  nextHeliAt = 0;
  web = { active:false, anchor:null, len:0 };
  keys = { left:false, right:false };
  pumpVel = 0;
  missMarker = null;
  webThrow = null;

  if (!stats.skinsUsed.includes(SKINS[selectedSkin].id)){
    stats.skinsUsed.push(SKINS[selectedSkin].id);
    saveStats();
  }

  buildings.push({ x:-100, width:340, height:H*0.42, landmark:null });
  let lastEnd = 240;
  while (lastEnd < W*2){
    const gap = 60 + Math.random()*100;
    const width = 110 + Math.random()*170;
    const height = H*(0.36 + Math.random()*0.42);
    const x = lastEnd + gap;
    const b = makeBuilding(x, width, height);
    buildings.push(b);
    lastEnd = x + b.width;
  }

  const first = buildings[0];
  startBuilding = first;
  canLand = true;
  player = {
    x: first.x + first.width/2, y: groundY - first.height - 14,
    px: 0, py: 0, radius: 14, grounded: true, facing: 1, autoShoot: false, autoShootTimer: 0, shootCooldown: 0, extraLives: 0, riding: null, flowCombo: 0, attachFrame: 0, attachX: 0
  };
  player.px = player.x; player.py = player.y;
  updateLifeHud();
  const flowEl0 = document.getElementById('flowIndicator');
  if (flowEl0) flowEl0.style.display = 'none';

  gameOver = false;
  document.getElementById('overlay').classList.remove('show');
}

function ensureBuildings(){
  let last = buildings[buildings.length-1];
  while (last.x + last.width < cameraX + W + 500){
    const gap = 60 + Math.random()*110;
    const width = 110 + Math.random()*180;
    const height = H*(0.34 + Math.random()*0.42);
    const x = last.x + last.width + gap;
    const b = makeBuilding(x, width, height);
    buildings.push(b);
    last = b;
  }
  buildings = buildings.filter(b => b.x + b.width > cameraX - 300);
}

export const POWERUP_TYPES = ['jump', 'shoot', 'life'];

function registerEnemyType(type){
  if (!stats.enemyTypesSeen) stats.enemyTypesSeen = [];
  if (!stats.enemyTypesSeen.includes(type)){
    stats.enemyTypesSeen.push(type);
    saveStats();
  }
}

function ensurePowerUps(){
  let lastX = powerUps.length ? powerUps[powerUps.length-1].x : 500;
  while (lastX < cameraX + W + 700){
    lastX += 420 + Math.random()*340;
    const type = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
    const y = groundY - (H*0.28 + Math.random()*H*0.4);
    powerUps.push({ x:lastX, y, type });
  }
  powerUps = powerUps.filter(p => p.x > cameraX - 200);
}

function pointToSegmentDist(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx*dx + dy*dy;
  let t = lenSq ? ((px-x1)*dx + (py-y1)*dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + dx*t, cy = y1 + dy*t;
  return Math.hypot(px-cx, py-cy);
}

function applyPowerUp(type){
  if (type === 'jump'){
    web.active = false;
    player.px = player.x - 15;
    player.py = player.y + 19;
    pickupMsg = { text: '¡Súper salto! 🚀', timer: 70 };
  } else if (type === 'shoot'){
    player.autoShoot = true;
    player.autoShootTimer = AUTO_SHOOT_DURATION;
    pickupMsg = { text: '¡Disparo automático! 🕸️', timer: 70 };
  } else if (type === 'life'){
    player.extraLives++;
    pickupMsg = { text: '¡Vida extra! Ahora tenés ' + player.extraLives + ' 💫', timer: 70 };
    updateLifeHud();
  }
}

function updateLifeHud(){
  const el = document.getElementById('lifeIndicator');
  if (!el) return;
  if (player.extraLives > 0){
    el.style.display = 'inline';
    el.textContent = '💫 x' + player.extraLives;
  } else {
    el.style.display = 'none';
  }
}

// dificultad progresiva: nada al principio, después va apareciendo y cada vez más seguido
export const DIFF = {
  goblinStart: 300, climberStart: 800, rhinoStart: 1100, sandStart: 1500,
  scorpionStart: 1900, landmarkStart: 500, craneStart: 1200, heliStart: 700,
};

function ensureEnemies(){
  if (progressM >= DIFF.goblinStart){
    let lastX = enemies.length ? enemies[enemies.length-1].x : cameraX + 700;
    const p = progressM - DIFF.goblinStart;
    const spacingBase = Math.max(1000, 2600 - p*0.6);
    const spacingRand = Math.max(600, 1800 - p*0.4);
    while (lastX < cameraX + W + 900){
      lastX += spacingBase + Math.random()*spacingRand;
      const y = groundY - (180 + Math.random()*H*0.4);
      enemies.push({ x:lastX, y, baseY:y, phase: Math.random()*10, hit:false, counted:false });
    }
  }
  for (const en of enemies){
    if (!en.hit && !en.counted && en.x < cameraX - 250){
      en.counted = true;
      stats.totalEnemiesAvoided++;
      registerEnemyType('goblin');
      saveStats();
    }
  }
  enemies = enemies.filter(en => en.x > cameraX - 500);
}

function ensureClimbers(){
  if (progressM >= DIFF.climberStart){
    const p = progressM - DIFF.climberStart;
    const spacing = Math.max(900, 2600 - p*0.5);
    let lastX = climbers.length ? climbers[climbers.length-1].x : -Infinity;
    for (const b of buildings){
      if (b.climberChecked) continue;
      if (b.x > cameraX + W + 900) continue;
      b.climberChecked = true;
      if (b.width < 70) continue;
      if (b.x - lastX < spacing) continue;
      if (Math.random() > 0.6) continue;

      const top = groundY - b.height;
      const usableH = Math.max(40, Math.min(b.height - 30, H*0.55));
      const baseY = top + 30 + Math.random() * usableH;
      const climbRange = Math.min(usableH * 0.4, Math.min(120, 50 + p*0.05));
      const speed = Math.min(1.4, 0.55 + p*0.0004);
      climbers.push({
        x: b.x + b.width*0.5, baseY, climbRange, speed, phase: Math.random()*10,
        wallTop: top + 12, wallBottom: groundY - 12, hit:false, counted:false
      });
      lastX = b.x;
    }
  }
  for (const c of climbers){
    if (!c.hit && !c.counted && c.x < cameraX - 250){
      c.counted = true;
      stats.totalEnemiesAvoided++;
      registerEnemyType('climber');
      saveStats();
    }
  }
  climbers = climbers.filter(c => c.x > cameraX - 500);
}

function ensureSandHands(){
  if (progressM >= DIFF.sandStart){
    let lastX = sandHands.length ? sandHands[sandHands.length-1].x : cameraX + 1100;
    const p = progressM - DIFF.sandStart;
    const spacingBase = Math.max(1400, 3400 - p*0.5);
    const spacingRand = Math.max(700, 1700 - p*0.3);
    while (lastX < cameraX + W + 1200){
      lastX += spacingBase + Math.random()*spacingRand;
      sandHands.push({ x:lastX, hit:false, counted:false });
    }
  }
  for (const s of sandHands){
    if (!s.hit && !s.counted && s.x < cameraX - 300){
      s.counted = true;
      stats.totalEnemiesAvoided++;
      registerEnemyType('sandhand');
      saveStats();
    }
  }
  sandHands = sandHands.filter(s => s.x > cameraX - 600);
}

function ensureRhinos(){
  if (progressM >= DIFF.rhinoStart){
    let lastX = rhinos.length ? rhinos[rhinos.length-1].spawnX : cameraX + 900;
    const p = progressM - DIFF.rhinoStart;
    const spacingBase = Math.max(1300, 3200 - p*0.5);
    const spacingRand = Math.max(700, 1700 - p*0.3);
    while (lastX < cameraX + W + 1000){
      lastX += spacingBase + Math.random()*spacingRand;
      const speed = Math.min(5.5, 2.3 + p*0.001);
      rhinos.push({ x:lastX, spawnX:lastX, speed, hit:false, counted:false });
    }
  }
  for (const r of rhinos){
    if (!r.hit && !r.counted && r.x < cameraX - 250){
      r.counted = true;
      stats.totalEnemiesAvoided++;
      registerEnemyType('rhino');
      saveStats();
    }
  }
  rhinos = rhinos.filter(r => r.x > cameraX - 400 && r.x < cameraX + W + 2000);
}

function ensureScorpions(){
  if (progressM >= DIFF.scorpionStart){
    const p = progressM - DIFF.scorpionStart;
    const spacing = Math.max(1300, 3200 - p*0.5);
    let lastX = scorpions.length ? scorpions[scorpions.length-1].x : -Infinity;
    for (const b of buildings){
      if (b.scorpionChecked) continue;
      if (b.x > cameraX + W + 900) continue;
      b.scorpionChecked = true;
      if (b.width < 60) continue;
      if (b.x - lastX < spacing) continue;
      if (Math.random() > 0.55) continue;
      const top = groundY - b.height;
      const baseCooldown = Math.max(65, 210 - p*0.07);
      scorpions.push({ x: b.x + b.width*0.5, y: top - 4, baseCooldown, cooldown: baseCooldown*0.6, hit:false, counted:false });
      lastX = b.x;
    }
  }
  for (const s of scorpions){
    if (!s.hit && !s.counted && s.x < cameraX - 250){
      s.counted = true;
      stats.totalEnemiesAvoided++;
      registerEnemyType('scorpion');
      saveStats();
    }
  }
  scorpions = scorpions.filter(s => s.x > cameraX - 500 && !s.defeated);
}

function ensureCranes(){
  if (progressM >= DIFF.craneStart){
    let lastX = cranes.length ? cranes[cranes.length-1].baseX : cameraX + 900;
    const p = progressM - DIFF.craneStart;
    const spacingBase = Math.max(1500, 3200 - p*0.4);
    const spacingRand = Math.max(800, 1600 - p*0.25);
    while (lastX < cameraX + W + 1200){
      lastX += spacingBase + Math.random()*spacingRand;
      const jibLength = 170 + Math.random()*100;
      const y = groundY - (H*0.35 + Math.random()*H*0.25);
      const speed = 0.32 + Math.random()*0.22;
      cranes.push({ baseX:lastX, jibLength, y, speed, phase: Math.random()*10, hookX:lastX, hookY:y });
    }
  }
  cranes = cranes.filter(c => c.baseX > cameraX - 700 && c.baseX < cameraX + W + 2000);
}

function craneHookAt(worldX, worldY){
  for (const c of cranes){
    if (Math.hypot(worldX - c.hookX, worldY - c.hookY) < 26) return c;
  }
  return null;
}

function ensureHelicopter(){
  if (helicopters.length > 0) return;
  if (progressM < DIFF.heliStart) return;
  if (!nextHeliAt) nextHeliAt = DIFF.heliStart + 900 + Math.random()*700;
  if (progressM < nextHeliAt) return;
  helicopters.push({
    x: cameraX + W + 150, y: groundY - H*0.62,
    speed: 1.6, state: 'flying', rideTimer: 0
  });
  nextHeliAt = progressM + 2600 + Math.random()*1800;
}

function buildingAt(worldX, worldY){
  const pad = 16;
  for (const b of buildings){
    if (worldX >= b.x - pad && worldX <= b.x + b.width + pad &&
        worldY >= groundY - b.height - pad && worldY <= groundY){
      return b;
    }
  }
  return null;
}

function heliAt(worldX, worldY){
  for (const h of helicopters){
    if (h.state === 'flying' && Math.hypot(worldX - h.x, worldY - h.y) < 34) return h;
  }
  return null;
}

// ---------- input ----------
// Reemplaza al viejo worldFromClient(): world3d.js inyecta acá su raycast contra
// el plano z=0 (matemáticamente idéntico al viejo `{x: clientX+cameraX, y: clientY}`
// para todo lo que esté en ese plano — ver Fase 0 del plan).
let raycastToWorld = (clientX, clientY) => ({ x: clientX + cameraX, y: clientY });
export function setRaycaster(fn){ raycastToWorld = fn; }

function tryShootWeb(clientX, clientY){
  if (player.riding) return;
  const p = raycastToWorld(clientX, clientY);
  const dx = p.x - player.x, dy = p.y - player.y;
  const dist = Math.hypot(dx, dy);
  if (dist > MAX_WEB){
    missMarker = { x: p.x, y: p.y, timer: 26 };
    webThrow = { fromX: player.x, fromY: player.y, toX: p.x, toY: p.y, timer: 9 };
    return;
  }

  const heli = heliAt(p.x, p.y);
  if (heli){
    heli.state = 'riding';
    heli.rideTimer = 260;
    player.riding = heli;
    web.active = false;
    pickupMsg = { text: '¡Enganchado al helicóptero! 🚁', timer: 70 };
    return;
  }

  const crane = craneHookAt(p.x, p.y);
  const target = dist >= 10 ? buildingAt(p.x, p.y) : null;
  if ((target && player.y > groundY - target.height) || crane){
    web.active = true;
    web.anchor = { x: p.x, y: p.y };
    web.len = dist;
    web.baseLen = dist;
    player.grounded = false;
    player.attachFrame = elapsedFrames;
    player.attachX = player.x;
  } else {
    missMarker = { x: p.x, y: p.y, timer: 26 };
    webThrow = { fromX: player.x, fromY: player.y, toX: p.x, toY: p.y, timer: 9 };
  }
}

function releaseWeb(){
  if (web.active){
    player.py += BASE_RELEASE_LIFT;
    const duration = elapsedFrames - player.attachFrame;
    const traveled = player.x - player.attachX;
    if (duration > 3 && duration < FAST_SWING_FRAMES && traveled > MIN_FLOW_DISTANCE){
      player.flowCombo = Math.min(player.flowCombo + 1, MAX_FLOW_COMBO);
    } else if (duration >= FAST_SWING_FRAMES){
      player.flowCombo = 0;
    }
    if (player.flowCombo > 0){
      player.py += FLOW_BOOST_PER_COMBO * player.flowCombo;
      if (player.flowCombo >= 2) pickupMsg = { text: '🔥 Racha x' + player.flowCombo, timer: 35 };
    }
  }
  const flowEl = document.getElementById('flowIndicator');
  if (flowEl){
    if (player.flowCombo >= 2){
      flowEl.style.display = 'inline';
      flowEl.textContent = '🔥 x' + player.flowCombo;
    } else {
      flowEl.style.display = 'none';
    }
  }
  web.active = false;
}

let pointerDown = false;
canvas.addEventListener('pointerdown', e => {
  pointerDown = true;
  if (player.grounded){
    player.grounded = false;
    canLand = false;
  }
  tryShootWeb(e.clientX, e.clientY);
});
addEventListener('pointerup', () => { pointerDown = false; releaseWeb(); });
addEventListener('pointermove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
});
canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
canvas.addEventListener('touchend', e => e.preventDefault(), { passive: false });

canvas.addEventListener('wheel', e => {
  if (web.active && web.baseLen){
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    const proposed = web.len + dir*6;
    web.len = Math.max(web.baseLen - ROPE_ADJUST_RANGE, Math.min(web.baseLen + ROPE_ADJUST_RANGE, proposed));
  }
}, { passive: false });

let mouseX = W/2, mouseY = H/2;
let prevMouseX = mouseX, prevMouseY = mouseY;

addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = true;
  if (e.code === 'Space' || e.code === 'ArrowUp'){
    if (player.grounded){
      player.py = player.y - JUMP_VY;
      player.grounded = false;
      canLand = false;
    }
  }
  if (e.code === 'Enter' && gameOver) restart();
  if ((e.code === 'Escape' || e.code === 'KeyP') && !gameOver) togglePause();
});
addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});

export function togglePause(){
  if (gameOver) return;
  paused = !paused;
  document.getElementById('pauseOverlay').classList.toggle('show', paused);
}

export function showMenu(){
  paused = false;
  gameOver = true;
  document.getElementById('pauseOverlay').classList.remove('show');
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('hud').style.display = 'none';
  document.getElementById('hint').style.display = 'none';
  document.getElementById('pauseBtn').style.display = 'none';
  document.getElementById('startOverlay').style.display = 'flex';
  onShowMenu();
}
let onShowMenu = () => {};
export function setShowMenuHandler(fn){ onShowMenu = fn; }

export function restart(){
  initGame();
}

// ---------- física / update ----------
export function update(){
  if (gameOver) return;

  elapsedFrames++;
  const cycleIndex = Math.floor(elapsedFrames / DAY_CYCLE_FRAMES);
  if (cycleIndex > lastCycleIndex){
    stats.totalDayCycles += (cycleIndex - lastCycleIndex);
    lastCycleIndex = cycleIndex;
    saveStats();
  }

  progressM = Math.max(progressM, Math.floor((player.x - startBuilding.x) / 10));

  let vx = player.x - player.px;
  let vy = player.y - player.py;

  if (player.riding){
    const h = player.riding;
    player.px = player.x; player.py = player.y;
    player.x = h.x - 10;
    player.y = h.y + 22;
    player.facing = 1;
  } else {
  player.px = player.x;
  player.py = player.y;

  vx *= DAMPING; vy *= DAMPING;

  let ax = 0, ay = GRAVITY;
  if (!web.active && !player.grounded){
    if (keys.left) ax -= AIR_CONTROL;
    if (keys.right) ax += AIR_CONTROL;
  }
  if (player.grounded){
    ay = 0; vy = 0;
    if (keys.left) player.x -= 4;
    if (keys.right) player.x += 4;
  }

  if (web.active && pointerDown){
    const mouseDX = mouseX - prevMouseX;
    const target = Math.max(-6, Math.min(6, mouseDX)) * 0.022;
    pumpVel += (target - pumpVel) * 0.1;
  } else {
    pumpVel *= 0.9;
  }
  pumpVel = Math.max(-0.18, Math.min(0.18, pumpVel));
  ax += pumpVel;
  prevMouseX = mouseX;

  if (web.active && pointerDown && web.baseLen){
    const mouseDY = mouseY - prevMouseY;
    const proposed = web.len - mouseDY * 0.18;
    web.len = Math.max(web.baseLen - ROPE_ADJUST_RANGE, Math.min(web.baseLen + ROPE_ADJUST_RANGE, proposed));
  }
  prevMouseY = mouseY;

  player.x += vx + ax;
  player.y += vy + ay;

  if (vx > 0.05) player.facing = 1;
  if (vx < -0.05) player.facing = -1;

  if (web.active){
    const dx = player.x - web.anchor.x;
    const dy = player.y - web.anchor.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const diff = (dist - web.len) / dist;
    player.x -= dx * diff;
    player.y -= dy * diff;
  }
  }

  sessionMaxHeightPx = Math.max(sessionMaxHeightPx, groundY - player.y);

  for (let i = powerUps.length - 1; i >= 0; i--){
    const p = powerUps[i];
    let touched = Math.hypot(player.x - p.x, player.y - p.y) < player.radius + 17;
    if (!touched && web.active){
      touched = pointToSegmentDist(p.x, p.y, player.x, player.y, web.anchor.x, web.anchor.y) < 17;
    }
    if (touched){
      applyPowerUp(p.type);
      powerUps.splice(i, 1);
      stats.totalPowerUps++;
      saveStats();
    }
  }
  if (pickupMsg){
    pickupMsg.timer--;
    if (pickupMsg.timer <= 0) pickupMsg = null;
  }
  if (missMarker){
    missMarker.timer--;
    if (missMarker.timer <= 0) missMarker = null;
  }
  if (webThrow){
    webThrow.timer--;
    if (webThrow.timer <= 0) webThrow = null;
  }

  function findAutoShootTarget(){
    let best = null, bestDist = Infinity;
    const consider = (x, y) => {
      if (x < cameraX - 60 || x > cameraX + W + 60) return;
      const d = Math.hypot(x - player.x, y - player.y);
      if (d < bestDist){ bestDist = d; best = { x, y }; }
    };
    for (const en of enemies) if (!en.hit) consider(en.drawX !== undefined ? en.drawX : en.x, en.y);
    for (const c of climbers) if (!c.hit) consider(c.x, c.y);
    for (const r of rhinos) if (!r.hit) consider(r.x, groundY - 40);
    for (const s of sandHands) if (!s.hit && s.heightFactor > 0.3) consider(s.x, s.topY);
    for (const s of scorpions) if (!s.hit) consider(s.x, s.y);
    return best;
  }

  if (player.autoShoot){
    player.autoShootTimer--;
    if (player.autoShootTimer <= 0){
      player.autoShoot = false;
    } else if (player.shootCooldown > 0){
      player.shootCooldown--;
    } else {
      const tgt = findAutoShootTarget();
      if (tgt){
        player.shootCooldown = AUTO_SHOOT_COOLDOWN;
        const dx = tgt.x - player.x, dy = tgt.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        const speed = 9;
        webShots.push({ x: player.x, y: player.y, vx: dx/d*speed, vy: dy/d*speed, life: 90 });
      }
    }
  }

  function tryDefeatNear(x, y, radius){
    for (const en of enemies){
      const ex = en.drawX !== undefined ? en.drawX : en.x;
      if (!en.hit && Math.hypot(x - ex, y - en.y) < radius + 12){
        en.hit = true; en.defeated = true;
        registerEnemyType('goblin'); stats.enemiesDefeated++; saveStats();
        return true;
      }
    }
    for (const c of climbers){
      if (!c.hit && Math.hypot(x - c.x, y - c.y) < radius + 18){
        c.hit = true; c.defeated = true;
        registerEnemyType('climber'); stats.enemiesDefeated++; saveStats();
        return true;
      }
    }
    for (const r of rhinos){
      if (!r.hit && Math.hypot(x - r.x, y - (groundY - 20)) < radius + 30){
        r.hit = true; r.defeated = true;
        registerEnemyType('rhino'); stats.enemiesDefeated++; saveStats();
        return true;
      }
    }
    for (const s of sandHands){
      if (!s.hit && s.heightFactor > 0.3 && Math.hypot(x - s.x, y - s.topY) < radius + 25){
        s.hit = true; s.defeated = true;
        registerEnemyType('sandhand'); stats.enemiesDefeated++; saveStats();
        return true;
      }
    }
    for (const s of scorpions){
      if (!s.hit && Math.hypot(x - s.x, y - s.y) < radius + 16){
        s.hit = true; s.defeated = true;
        registerEnemyType('scorpion'); stats.enemiesDefeated++; saveStats();
        return true;
      }
    }
    return false;
  }

  for (let i = webShots.length - 1; i >= 0; i--){
    const w = webShots[i];
    w.x += w.vx; w.y += w.vy;
    w.life--;
    if (tryDefeatNear(w.x, w.y, 14) || w.life <= 0 ||
        w.x < cameraX - 100 || w.x > cameraX + W + 200){
      webShots.splice(i, 1);
    }
  }

  function resolveEnemyHit(defeatMsg, failTitle){
    if (player.extraLives > 0){
      player.extraLives--;
      stats.extraLifeUses++;
      stats.enemiesDefeated++;
      saveStats();
      player.py = player.y + 24;
      player.px = player.x - 12;
      pickupMsg = { text: defeatMsg, timer: 70 };
      updateLifeHud();
      return true;
    } else {
      deathTitle = failTitle;
      triggerGameOver();
      return false;
    }
  }

  const t = Date.now() / 1000;
  for (const en of enemies){
    en.y = en.baseY + Math.sin(t*0.8 + en.phase) * 26;
    en.drawX = en.x + Math.sin(t*0.5 + en.phase) * 40;
    if (!en.hit && Math.hypot(player.x - en.drawX, player.y - en.y) < player.radius + 15){
      en.hit = true;
      registerEnemyType('goblin');
      if (resolveEnemyHit('¡Derrotaste al villano! 💫', '🦹 El villano volador te atrapó')) en.defeated = true;
    }
  }
  enemies = enemies.filter(en => !en.defeated);

  for (const c of climbers){
    const raw = c.baseY + Math.sin(t*c.speed + c.phase) * c.climbRange;
    c.y = Math.max(c.wallTop, Math.min(c.wallBottom, raw));
    if (!c.hit && Math.hypot(player.x - c.x, player.y - c.y) < player.radius + 26){
      c.hit = true;
      registerEnemyType('climber');
      if (resolveEnemyHit('¡Esquivaste al trepador! 💫', '🦾 El trepador mecánico te atrapó')) c.defeated = true;
    }
  }
  climbers = climbers.filter(c => !c.defeated);

  const sandMaxReach = Math.min(H*0.85, H*0.5 + Math.max(0, progressM - DIFF.sandStart) * 0.05);
  for (const s of sandHands){
    const local = Math.max(0, Math.min(1, (player.x - (s.x - 150)) / 300));
    s.heightFactor = Math.sin(local * Math.PI);
    s.topY = groundY - s.heightFactor * sandMaxReach;
    if (!s.hit && s.heightFactor > 0.3 && Math.abs(player.x - s.x) < 55 && player.y >= s.topY - 12){
      s.hit = true;
      registerEnemyType('sandhand');
      if (resolveEnemyHit('¡Te escapaste de la mano de arena! 💫', '✋ La mano de arena te atrapó')) s.defeated = true;
    }
  }
  sandHands = sandHands.filter(s => !s.defeated);

  const rhinoZone = Math.min(150, 75 + Math.max(0, progressM - DIFF.rhinoStart) * 0.03);
  for (const r of rhinos){
    r.x += r.speed;
    if (!r.hit && Math.abs(player.x - r.x) < 44 && player.y > groundY - rhinoZone){
      r.hit = true;
      registerEnemyType('rhino');
      if (resolveEnemyHit('¡Esquivaste a Rhino! 💫', '🦏 Rhino te llevó puesto')) r.defeated = true;
    }
  }
  rhinos = rhinos.filter(r => !r.defeated);

  for (const s of scorpions){
    if (Math.abs(player.x - s.x) < 750){
      s.cooldown--;
      if (s.cooldown <= 0){
        s.cooldown = s.baseCooldown;
        registerEnemyType('scorpion');
        const dx = player.x - s.x, dy = player.y - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        const speed = 6.5;
        poisonBolts.push({ x:s.x, y:s.y, vx: dx/dist*speed, vy: dy/dist*speed - 1.4 });
      }
    }
  }
  for (let i = poisonBolts.length - 1; i >= 0; i--){
    const p = poisonBolts[i];
    p.vy += 0.1;
    p.x += p.vx; p.y += p.vy;
    if (Math.hypot(player.x - p.x, player.y - p.y) < player.radius + 8){
      poisonBolts.splice(i, 1);
      resolveEnemyHit('¡Esquivaste el veneno! 💫', '🦂 El veneno de Escorpión te alcanzó');
      continue;
    }
    if (p.x < cameraX - 100 || p.x > cameraX + W + 100 || p.y > groundY + 40){
      poisonBolts.splice(i, 1);
    }
  }

  for (const c of cranes){
    const sway = Math.sin(t * c.speed + c.phase) * 0.5 + 0.5;
    c.hookX = c.baseX + sway * c.jibLength;
    c.hookY = c.y;
  }

  for (const h of helicopters){
    if (h.state === 'flying'){
      h.x += h.speed;
    } else if (h.state === 'riding'){
      h.x += 6.2;
      h.rideTimer--;
      if (h.rideTimer <= 0){
        h.state = 'leaving';
        player.riding = null;
      }
    } else if (h.state === 'leaving'){
      h.x += 3.5;
      h.y -= 3.2;
    }
  }
  helicopters = helicopters.filter(h => h.y < groundY + 100 && h.x < cameraX + W + 900 && h.x > cameraX - 900);

  player.grounded = false;
  if (canLand){
    const b = startBuilding;
    const top = groundY - b.height;
    const withinX = player.x + player.radius*0.6 > b.x && player.x - player.radius*0.6 < b.x + b.width;
    if (withinX && player.y + player.radius >= top && player.y + player.radius <= top + 22 && (player.y - player.py) >= -1){
      player.y = top - player.radius;
      player.py = player.y;
      player.grounded = true;
      web.active = false;
    }
  }

  if (player.y + player.radius >= groundY){
    if (player.extraLives > 0){
      player.extraLives--;
      stats.extraLifeUses++;
      saveStats();
      player.y = groundY - player.radius - 4;
      player.py = player.y + 26;
      player.px = player.x - 8;
      pickupMsg = { text: '¡Rebote! Seguís en juego 💫', timer: 70 };
      updateLifeHud();
    } else {
      player.y = groundY - player.radius;
      deathTitle = '💥 Tocaste el piso';
      triggerGameOver();
    }
  }

  const camTarget = Math.max(startBuilding.x - 120, player.x - W*0.35);
  cameraX += (camTarget - cameraX) * 0.18;
  ensureBuildings();

  for (const b of buildings){
    if (b.landmark && !b.landmarkCounted && player.x > b.x + b.width){
      b.landmarkCounted = true;
      stats.landmarkCounts[b.landmark] = (stats.landmarkCounts[b.landmark] || 0) + 1;
      saveStats();
    }
  }

  ensurePowerUps();
  ensureEnemies();
  ensureClimbers();
  ensureSandHands();
  ensureRhinos();
  ensureScorpions();
  ensureCranes();
  ensureHelicopter();

  score = Math.max(score, Math.floor((player.x - startBuilding.x) / 10));
  document.getElementById('score').textContent = score;
  if (score > best){ best = score; document.getElementById('best').textContent = best; }
}

export function triggerGameOver(){
  if (gameOver) return;
  gameOver = true;
  web.active = false;
  document.getElementById('deathTitle').textContent = deathTitle;
  document.getElementById('finalScore').textContent = score;
  document.getElementById('overlay').classList.add('show');

  const heightMeters = Math.floor(sessionMaxHeightPx / 10);
  const isNewRecord = score > stats.bestDistance;
  stats.bestDistance = Math.max(stats.bestDistance, score);
  stats.bestHeight = Math.max(stats.bestHeight, heightMeters);
  saveStats();

  const recordEl = document.getElementById('recordLine');
  recordEl.textContent = isNewRecord
    ? '🏆 ¡Nuevo récord en este dispositivo!'
    : 'Tu récord en este dispositivo: ' + stats.bestDistance + ' m';
}
