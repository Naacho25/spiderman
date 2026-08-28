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
import { vfxGroup, worldToScene, toonGradientMap, addCameraShake, TIER, qualityTier } from './world3d.js';
import * as state from './state.js';

const isLowTier = qualityTier === 'low';

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
// onDispose (opcional): varios de los pools de abajo crean geometría/material
// ÚNICOS por instancia (clones de material para poder variar opacidad/color
// por-instancia, o geometría/material armados desde cero por ícono de
// power-up) — a diferencia de un pool "puro" que solo reusa recursos
// compartidos, esos SÍ hay que disponerlos al sacar el objeto, o quedan
// filtrando uno nuevo por cada disparo/veneno/power-up que pasó por pantalla.
function pool(makeFn, onDispose){
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
        if (!alive.has(obj)){
          vfxGroup.remove(m);
          if (onDispose) onDispose(m);
          byObj.delete(obj);
        }
      }
    }
  };
}

// ---------- disparos automáticos: dardo blanco/plateado + estela corta ----------
// tier low: menos segmentos de estela por dardo — cada uno es un Mesh
// transparente aparte, y puede haber varios disparos en pantalla a la vez
// (draw calls + overdraw aditivo se multiplican por disparo).
const SHOT_TRAIL_LEN = isLowTier ? 2 : 3;
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
}, g => { for (const m of g.userData.trail) m.material.dispose(); }); // trail[i].material es shotTrailMat.clone(), único por dardo — su geometría (shotTipGeo) sigue siendo compartida y no se toca

// ---------- veneno de escorpión: gota tóxica verde + estela con "goteo" ----------
// tier low: mismo motivo que SHOT_TRAIL_LEN arriba.
const POISON_TRAIL_LEN = isLowTier ? 2 : 3;
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
}, g => { for (const m of g.userData.trail) m.material.dispose(); }); // trail[i].material es poisonTrailMat.clone(), único por gota — su geometría (poisonGeo) sigue siendo compartida y no se toca

// ---------- power-ups: silueta distinta por tipo + halo que alimenta el bloom ----------
// Estos objetos DEBEN destacarse contra un fondo cada vez más ocupado (edificios,
// ventanas, gente, autos, carteles de neón) mientras el jugador se mueve rápido:
// glow grande de doble capa, haz de luz vertical, pulso de escala marcado y
// partículas orbitando. Todo aprovecha el UnrealBloomPass (threshold 0.72 en
// world3d.js) con colores saturados + toneMapped:false para "explotar" en bloom.

// textura de haz vertical: gradiente vertical (opaco abajo -> transparente arriba)
// recortado por un gradiente horizontal (brillante al centro, se apaga en los bordes)
function makeBeamTexture(){
  const w = 32, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d');
  const vg = cx.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(255,255,255,0)');
  vg.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  vg.addColorStop(1, 'rgba(255,255,255,1)');
  cx.fillStyle = vg;
  cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = 'destination-in';
  const hg = cx.createLinearGradient(0, 0, w, 0);
  hg.addColorStop(0, 'rgba(255,255,255,0)');
  hg.addColorStop(0.5, 'rgba(255,255,255,1)');
  hg.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = hg;
  cx.fillRect(0, 0, w, h);
  cx.globalCompositeOperation = 'source-over';
  return new THREE.CanvasTexture(c);
}
const beamTex = makeBeamTexture();

// trapecio angosto (más ancho abajo, angosto arriba) con pivote en su base ->
// se posiciona en el power-up y sube visualmente sin más cuentas por frame
function makeBeamGeometry(height, bottomWidth, topWidth){
  const hw0 = bottomWidth / 2, hw1 = topWidth / 2;
  const positions = new Float32Array([
    -hw0, 0, 0,   hw0, 0, 0,   hw1, height, 0,   -hw1, height, 0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  return geo;
}
// tier low: haz más corto — menos superficie total cubierta por un material
// con AdditiveBlending (el blending aditivo es el costo real, no la cuenta
// de triángulos: son 2 triángulos siempre, pero ocupan menos píxeles).
const beamGeo = makeBeamGeometry(isLowTier ? 130 : 200, 15, 3);
const beamBaseMat = new THREE.MeshBasicMaterial({
  map: beamTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending, toneMapped: false,
});

const orbitDotGeo = new THREE.SphereGeometry(1.6, 6, 5);

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
  const mat = new THREE.MeshToonMaterial({ color: '#ffd166', gradientMap: toonGradientMap, emissive: '#ff9d00', emissiveIntensity: 1.3, toneMapped: false });
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
  g.userData.tint = '#ff9d00';
  return g;
}

function buildShootIcon(){
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: '#78dcff', gradientMap: toonGradientMap, emissive: '#00e5ff', emissiveIntensity: 1.3, toneMapped: false });
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
  g.userData.tint = '#00e5ff';
  return g;
}

// dispose del ícono de un power-up: buildJumpIcon/buildShootIcon arman
// geometría Y material NUEVOS en cada llamada (nada compartido entre
// power-ups), así que ambos hay que disponerlos. buildLifeIcon es la única
// excepción -- reusa el heartGeo de módulo (declarado una sola vez, abajo)
// entre TODOS los power-ups de vida, así que esa geometría puntual nunca se
// dispone acá (rompería el corazón de cualquier otro power-up de vida vivo).
function disposeIcon(icon){
  icon.traverse(o => {
    if (o.material) o.material.dispose();
    if (o.geometry && o.geometry !== heartGeo) o.geometry.dispose();
  });
}

const heartGeo = heartShapeGeometry();
function buildLifeIcon(){
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color: '#ff78aa', gradientMap: toonGradientMap, emissive: '#ff1f78', emissiveIntensity: 1.3, toneMapped: false });
  const heart = new THREE.Mesh(heartGeo, mat);
  // el shape ya se definió con la punta hacia abajo en coords Y-arriba de three.js
  // (ver heartShapeGeometry) — no necesita rotación adicional.
  heart.scale.setScalar(1.05);
  g.add(heart);
  g.userData.tint = '#ff1f78';
  return g;
}

const PU_BUILDERS = { jump: buildJumpIcon, shoot: buildShootIcon, life: buildLifeIcon };

const PU_GLOW_OUTER = 92; // ~3-4x el ancho típico del ícono (halo grande, alimenta el bloom)
const PU_GLOW_INNER = 34; // núcleo más chico y más opaco, da el "hot spot"
// tier low: menos partículas orbitando por power-up — con varios power-ups
// visibles a la vez cada una suma un mesh + draw call de más.
const PU_ORBIT_COUNT = isLowTier ? 2 : 3;
const PU_ORBIT_RADIUS = 15;
// tier low: TIER.particleScale (world3d.js) escala el tamaño de los sprites
// de glow aditivo — son el mayor riesgo de fill-rate de todo el archivo (un
// sprite aditivo grande cubre muchos píxeles, y con varios power-ups en
// pantalla el costo se multiplica). El núcleo se recorta menos que el halo
// exterior para que el power-up siga leyéndose como un "hot spot" nítido.
const PU_GLOW_OUTER_SCALE = isLowTier ? TIER.particleScale : 1;
const PU_GLOW_INNER_SCALE = isLowTier ? Math.max(TIER.particleScale, 0.7) : 1;

const puPool = pool((p) => {
  const g = new THREE.Group();
  const icon = (PU_BUILDERS[p.type] || buildJumpIcon)();
  // el ícono gira en su propio sub-grupo: si rotara el grupo raíz "g", el haz
  // (un Mesh plano, no un Sprite) heredaría esa rotación y quedaría de canto
  // -> invisible durante parte del ciclo. Los sprites de glow ignoran rotación
  // de sus ancestros (siempre miran a cámara), por eso solo el ícono la necesita.
  const iconSpin = new THREE.Group();
  iconSpin.add(icon);
  g.add(iconSpin);

  const tint = icon.userData.tint;

  // halo de dos capas: exterior grande y suave + núcleo chico y brillante
  const glowOuter = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: tint, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  glowOuter.scale.set(PU_GLOW_OUTER * PU_GLOW_OUTER_SCALE, PU_GLOW_OUTER * PU_GLOW_OUTER_SCALE, 1);
  g.add(glowOuter);

  const glowInner = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: '#ffffff', transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }));
  glowInner.scale.set(PU_GLOW_INNER * PU_GLOW_INNER_SCALE, PU_GLOW_INNER * PU_GLOW_INNER_SCALE, 1);
  g.add(glowInner);

  // haz de luz vertical: sube desde el power-up, visible aunque el ícono
  // quede tapado por algo en primer plano (edificios, carteles, gente)
  const beam = new THREE.Mesh(beamGeo, beamBaseMat.clone());
  beam.material.color.set(tint);
  beam.material.opacity = 0.5;
  beam.frustumCulled = false; // geometría compartida pero puede quedar fuera del
  // frustum "cacheado" al reposicionarse el grupo padre -> ver nota de culling arriba
  g.add(beam);

  // 2-3 partículas orbitando ("polvo de hada") -> movimiento constante que
  // llama la atención por el rabillo del ojo incluso sin mirar directo
  const orbitMat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.9, toneMapped: false });
  const orbitDots = [];
  for (let i = 0; i < PU_ORBIT_COUNT; i++){
    const dot = new THREE.Mesh(orbitDotGeo, orbitMat.clone());
    g.add(dot);
    orbitDots.push(dot);
  }

  g.userData.icon = icon;
  g.userData.iconSpin = iconSpin;
  g.userData.glowOuter = glowOuter;
  g.userData.glowInner = glowInner;
  g.userData.beam = beam;
  g.userData.orbitDots = orbitDots;
  g.userData.phase = Math.random() * Math.PI * 2;
  return g;
}, g => {
  // todo lo de acá es ÚNICO por power-up (icono propio, dos SpriteMaterial
  // propios, un .clone() de beamBaseMat, N .clone() de orbitMat) — nada de
  // esto es compartido entre power-ups, así que hay que disponerlo todo al
  // sacar el power-up del pool o queda filtrando GPU memory power-up tras
  // power-up durante toda la partida.
  disposeIcon(g.userData.icon);
  g.userData.glowOuter.material.dispose();
  g.userData.glowInner.material.dispose();
  g.userData.beam.material.dispose();
  for (const d of g.userData.orbitDots) d.material.dispose();
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

  // ---- power-ups: flotan, giran, pulsan y brillan para destacarse del fondo ----
  for (const p of state.powerUps){
    const g = puPool.get(p);
    const phase = g.userData.phase;
    const bob = Math.sin(now / 260 + phase) * 5;
    g.position.copy(worldToScene(p.x, p.y + bob));
    g.userData.iconSpin.rotation.y += 0.04;

    // pulso de escala del ícono (además del bob) -> más notorio por el rabillo del ojo
    const iconPulse = 1 + Math.sin(now / 300 + phase) * 0.15;
    g.userData.icon.scale.setScalar(iconPulse);

    // el halo pulsa aparte (más rápido/marcado) para reforzar el efecto "faro"
    const glowPulse = 1 + Math.sin(now / 220 + phase) * 0.22;
    g.userData.glowOuter.scale.set(PU_GLOW_OUTER * PU_GLOW_OUTER_SCALE * glowPulse, PU_GLOW_OUTER * PU_GLOW_OUTER_SCALE * glowPulse, 1);
    g.userData.glowOuter.material.opacity = 0.55 + Math.sin(now / 220 + phase) * 0.15;
    const innerPulse = 1 + Math.sin(now / 220 + phase + 0.6) * 0.18;
    g.userData.glowInner.scale.set(PU_GLOW_INNER * PU_GLOW_INNER_SCALE * innerPulse, PU_GLOW_INNER * PU_GLOW_INNER_SCALE * innerPulse, 1);

    // el haz vertical respira en opacidad para no ser un poste estático
    g.userData.beam.material.opacity = 0.35 + Math.sin(now / 400 + phase) * 0.15;

    // partículas orbitando en un anillo elíptico chico alrededor del ícono
    const dots = g.userData.orbitDots;
    for (let i = 0; i < dots.length; i++){
      const ang = now / 550 + phase + (i / dots.length) * Math.PI * 2;
      dots[i].position.set(
        Math.cos(ang) * PU_ORBIT_RADIUS,
        Math.sin(ang) * PU_ORBIT_RADIUS * 0.55 + Math.sin(now / 260 + phase) * 2,
        Math.sin(ang) * 3
      );
    }
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
