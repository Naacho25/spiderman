// ============================================================================
// Telaraña, marcadores de tiro, disparos, veneno y power-ups. Fase 2: volumen
// real (tubos, formas por tipo, estelas) en vez de líneas/esferas planas.
// Pide shake de cámara vía world3d.addCameraShake(), nunca toca camera directo.
//
// REGLA DE CULLING: cualquier THREE.Object3D cuya geometría se reposiciona o
// reconstruye cada frame (setFromPoints, TubeGeometry nueva, attribute.needsUpdate,
// etc.) NO recalcula solo su boundingSphere cacheado -> el frustum culling lo
// puede descartar "de la nada" en cuanto la cámara se mueve del punto donde se
// creó por primera vez. Todo objeto así en este archivo lleva frustumCulled = false.
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { vfxGroup, worldToScene, toonGradientMap, addCameraShake } from './world3d.js';
import * as state from './state.js';

// ---------- texturas generadas por canvas (una sola vez, reusadas) ----------
function makeGlowTexture(){
  const size = 64;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
const glowTex = makeGlowTexture();

function makeXTexture(){
  const size = 64;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const cx = c.getContext('2d');
  cx.strokeStyle = '#ff4d4d';
  cx.lineWidth = 8;
  cx.lineCap = 'round';
  cx.shadowColor = '#ff4d4d';
  cx.shadowBlur = 12;
  cx.beginPath();
  cx.moveTo(14, 14); cx.lineTo(50, 50);
  cx.moveTo(50, 14); cx.lineTo(14, 50);
  cx.stroke();
  return new THREE.CanvasTexture(c);
}
const xTex = makeXTexture();

// ---------- telaraña activa: tubo con leve catenaria en vez de línea plana ----------
const webMat = new THREE.MeshStandardMaterial({
  color: '#f4f4f8', roughness: 0.28, metalness: 0.15,
  emissive: '#aab4ff', emissiveIntensity: 0.35,
});
const webLine = new THREE.Mesh(new THREE.BufferGeometry(), webMat);
webLine.visible = false;
// la geometría se reconstruye cada frame (los dos extremos se mueven) -> ver
// nota de culling arriba: cualquier reconstrucción de geometría necesita esto.
webLine.frustumCulled = false;
vfxGroup.add(webLine);

function updateWebTube(mesh, a, b, radius, sagFactor){
  const dist = a.distanceTo(b);
  if (dist < 0.001) { mesh.visible = false; return; }
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= Math.min(dist * sagFactor, 22);
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const tubularSegments = Math.max(3, Math.min(10, Math.round(dist / 45)));
  const newGeo = new THREE.TubeGeometry(curve, tubularSegments, radius, 5, false);
  mesh.geometry.dispose();
  mesh.geometry = newGeo;
  mesh.visible = true;
}

// ---------- tiro fallido (X roja con pop + fade) + trazo del disparo ----------
const missMat = new THREE.SpriteMaterial({ map: xTex, transparent: true, depthWrite: false });
const missSprite = new THREE.Sprite(missMat);
missSprite.visible = false;
vfxGroup.add(missSprite);

const throwMat = new THREE.MeshStandardMaterial({
  color: '#f4f4f8', roughness: 0.3, metalness: 0.1,
  emissive: '#f4f4f8', emissiveIntensity: 0.5,
  transparent: true, opacity: 0.6,
});
const throwLine = new THREE.Mesh(new THREE.BufferGeometry(), throwMat);
throwLine.visible = false;
throwLine.frustumCulled = false; // mismo motivo que webLine, ver arriba
vfxGroup.add(throwLine);

// ---------- pool genérico: Map(objeto de estado -> mesh/grupo) ----------
// makeFn recibe el objeto de estado (útil para elegir geometría/tipo en la
// creación, una sola vez) — nunca se llama de nuevo mientras el objeto viva.
function pool(makeFn){
  const byObj = new Map();
  return {
    get(obj){
      let m = byObj.get(obj);
      if (!m){ m = makeFn(obj); vfxGroup.add(m); byObj.set(obj, m); }
      return m;
    },
    sweep(liveList){
      const alive = new Set(liveList);
      for (const [obj, m] of byObj){
        if (!alive.has(obj)){ vfxGroup.remove(m); byObj.delete(obj); }
      }
    }
  };
}

// ---------- disparos automáticos: dardo blanco/plateado + estela corta ----------
const SHOT_TRAIL_LEN = 3;
const shotBodyGeo = new THREE.SphereGeometry(3.4, 8, 6);
shotBodyGeo.scale(1.8, 1, 1); // dardo alargado, no esfera pelada
const shotTipGeo = new THREE.SphereGeometry(1.7, 6, 5);
const shotBodyMat = new THREE.MeshBasicMaterial({ color: '#eaeaf2', toneMapped: false });
const shotTipMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const shotTrailMat = new THREE.MeshBasicMaterial({ color: '#f4f4f8', transparent: true, toneMapped: false });

const shotPool = pool(() => {
  // el grupo raíz NO rota (evita que la rotación del dardo arrastre/deforme
  // la estela); solo el sub-grupo "dart" gira para apuntar hacia la velocidad.
  const g = new THREE.Group();
  const dart = new THREE.Group();
  const body = new THREE.Mesh(shotBodyGeo, shotBodyMat);
  const tip = new THREE.Mesh(shotTipGeo, shotTipMat);
  tip.position.x = 3;
  dart.add(body, tip);
  g.add(dart);
  const trail = [];
  for (let i = 0; i < SHOT_TRAIL_LEN; i++){
    const m = new THREE.Mesh(shotTipGeo, shotTrailMat.clone());
    const s = 1 - (i + 1) / (SHOT_TRAIL_LEN + 1);
    m.scale.setScalar(0.5 + s * 0.6);
    m.material.opacity = s * 0.55;
    g.add(m); // hijo directo de g (sin rotación), no del sub-grupo "dart"
    trail.push(m);
  }
  g.userData.dart = dart;
  g.userData.trail = trail;
  g.userData.history = [];
  return g;
});

// ---------- veneno de escorpión: gota tóxica verde + estela con "goteo" ----------
const POISON_TRAIL_LEN = 3;
const poisonGeo = new THREE.SphereGeometry(4.2, 8, 6);
const poisonMat = new THREE.MeshBasicMaterial({ color: '#8aff6a', toneMapped: false });
const poisonTrailMat = new THREE.MeshBasicMaterial({ color: '#5fce46', transparent: true, toneMapped: false });

const poisonPool = pool((p) => {
  const g = new THREE.Group();
  const body = new THREE.Mesh(poisonGeo, poisonMat);
  g.add(body);
  const trail = [];
  for (let i = 0; i < POISON_TRAIL_LEN; i++){
    const m = new THREE.Mesh(poisonGeo, poisonTrailMat.clone());
    const s = 1 - (i + 1) / (POISON_TRAIL_LEN + 1);
    m.scale.setScalar(0.35 + s * 0.5);
    m.material.opacity = s * 0.6;
    g.add(m);
    trail.push(m);
  }
  g.userData.body = body;
  g.userData.trail = trail;
  g.userData.history = [];
  g.userData.seed = Math.random() * 10;
  return g;
});

// ---------- power-ups: silueta distinta por tipo + halo que alimenta el bloom ----------
function heartShapeGeometry(){
  const s = new THREE.Shape();
  s.moveTo(0, -9);
  s.bezierCurveTo(-10, -1, -7, 9, 0, 3.5);
  s.bezierCurveTo(7, 9, 10, -1, 0, -9);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, 0, -2.8); // ExtrudeGeometry arranca en z=0 -> centrarla en su eje local
  return geo;
}

function buildJumpIcon(){
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: '#ffd166', gradientMap: toonGradientMap, emissive: '#ff9d3d', emissiveIntensity: 0.9 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 9, 8), mat);
  body.position.y = -3;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(4.6, 8, 8), mat);
  tip.position.y = 5.5;
  const finGeo = new THREE.ConeGeometry(2.2, 5, 3);
  const finL = new THREE.Mesh(finGeo, mat);
  finL.position.set(-3.4, -6.5, 0); finL.rotation.z = Math.PI * 0.62;
  const finR = new THREE.Mesh(finGeo, mat);
  finR.position.set(3.4, -6.5, 0); finR.rotation.z = -Math.PI * 0.62;
  g.add(body, tip, finL, finR);
  g.userData.tint = '#ffd166';
  return g;
}

function buildShootIcon(){
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: '#78dcff', gradientMap: toonGradientMap, emissive: '#4dd0e1', emissiveIntensity: 0.9 });
  const hub = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), mat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.5, 1.1, 6, 14), mat);
  g.add(hub, ring);
  const spokeGeo = new THREE.CylinderGeometry(0.55, 0.55, 9.5, 4);
  const spokeCount = 6;
  for (let i = 0; i < spokeCount; i++){
    const spoke = new THREE.Mesh(spokeGeo, mat);
    const ang = (i / spokeCount) * Math.PI * 2;
    spoke.position.set(Math.cos(ang) * 4.8, Math.sin(ang) * 4.8, 0);
    spoke.rotation.z = ang + Math.PI / 2;
    g.add(spoke);
  }
  g.userData.tint = '#78dcff';
  return g;
}

const heartGeo = heartShapeGeometry();
function buildLifeIcon(){
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: '#ff78aa', gradientMap: toonGradientMap, emissive: '#ff5d9e', emissiveIntensity: 1.0 });
  const heart = new THREE.Mesh(heartGeo, mat);
  // el shape ya se definió con la punta hacia abajo en coords Y-arriba de three.js
  // (ver heartShapeGeometry) — no necesita rotación adicional.
  heart.scale.setScalar(1.05);
  g.add(heart);
  g.userData.tint = '#ff78aa';
  return g;
}

const PU_BUILDERS = { jump: buildJumpIcon, shoot: buildShootIcon, life: buildLifeIcon };

const puPool = pool((p) => {
  const g = new THREE.Group();
  const icon = (PU_BUILDERS[p.type] || buildJumpIcon)();
  g.add(icon);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: icon.userData.tint, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(40, 40, 1);
  g.add(glow);

  g.userData.icon = icon;
  g.userData.spin = Math.random() * Math.PI * 2;
  return g;
});

let lastPowerUpCount = 0;

export function update(){
  const now = performance.now();

  // ---- telaraña activa ----
  if (state.web.active && state.web.anchor && state.player){
    const a = worldToScene(state.player.x, state.player.y);
    const b = worldToScene(state.web.anchor.x, state.web.anchor.y);
    updateWebTube(webLine, a, b, 1.5, 0.05);
  } else {
    webLine.visible = false;
  }

  // ---- marcador de tiro fallido: pop de aparición + fade ----
  if (state.missMarker){
    const t = 1 - state.missMarker.timer / 26; // 0 -> 1 a lo largo de la vida
    const fadeIn = Math.min(1, t / 0.15);
    const fadeOut = Math.min(1, (1 - t) / 0.35);
    const alpha = Math.min(fadeIn, fadeOut);
    const pop = 20 + (1 - fadeIn) * 14; // overshoot al aparecer
    missSprite.position.copy(worldToScene(state.missMarker.x, state.missMarker.y));
    missSprite.scale.set(pop, pop, 1);
    missMat.opacity = Math.max(0, alpha);
    missSprite.visible = true;
  } else {
    missSprite.visible = false;
  }

  // ---- trazo del tiro mientras viaja ----
  if (state.webThrow){
    const a = worldToScene(state.webThrow.fromX, state.webThrow.fromY);
    const b = worldToScene(state.webThrow.toX, state.webThrow.toY);
    throwMat.opacity = Math.max(0, state.webThrow.timer / 9) * 0.6;
    updateWebTube(throwLine, a, b, 0.9, 0.02);
  } else {
    throwLine.visible = false;
  }

  // ---- disparos automáticos (con estela) ----
  for (const w of state.webShots){
    const g = shotPool.get(w);
    const pos = worldToScene(w.x, w.y);
    g.userData.dart.rotation.z = Math.atan2(-w.vy, w.vx); // -vy: worldToScene invierte Y
    const hist = g.userData.history;
    hist.unshift(pos.clone());
    if (hist.length > SHOT_TRAIL_LEN + 1) hist.length = SHOT_TRAIL_LEN + 1;
    g.position.copy(pos);
    const trail = g.userData.trail;
    for (let i = 0; i < trail.length; i++){
      const hp = hist[i + 1];
      if (hp) trail[i].position.copy(hp).sub(pos);
    }
  }
  shotPool.sweep(state.webShots);

  // ---- veneno de escorpión (con estela y leve "goteo") ----
  for (const p of state.poisonBolts){
    const g = poisonPool.get(p);
    const pos = worldToScene(p.x, p.y);
    const hist = g.userData.history;
    hist.unshift(pos.clone());
    if (hist.length > POISON_TRAIL_LEN + 1) hist.length = POISON_TRAIL_LEN + 1;
    g.position.copy(pos);
    const wobble = 1 + Math.sin(now / 90 + g.userData.seed) * 0.12;
    g.userData.body.scale.set(wobble, 1 / wobble, 1);
    const trail = g.userData.trail;
    for (let i = 0; i < trail.length; i++){
      const hp = hist[i + 1];
      if (hp) trail[i].position.copy(hp).sub(pos);
    }
  }
  poisonPool.sweep(state.poisonBolts);

  // ---- power-ups: flotan, giran, brillan ----
  const bob = Math.sin(now / 260) * 5;
  for (const p of state.powerUps){
    const g = puPool.get(p);
    g.position.copy(worldToScene(p.x, p.y + bob));
    g.rotation.y += 0.04;
  }
  puPool.sweep(state.powerUps);

  if (state.stats.totalPowerUps !== lastPowerUpCount){
    lastPowerUpCount = state.stats.totalPowerUps;
  }

  // pequeño golpe de cámara al chocar con algo (feedback de impacto)
  if (state.pickupMsg && state.pickupMsg.timer === 70 && /Vengador|atrapó|rebote|Rebote/i.test(state.pickupMsg.text)){
    addCameraShake(4, 10);
  }
}
