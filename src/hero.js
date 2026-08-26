// ============================================================================
// Héroe: mesh procedural + animación procedural. Fase 2 (pase de arte real) —
// silueta compuesta (torso ahusado, hombros, brazos/piernas de dos segmentos),
// materiales toon cel-shaded + "rim light shell" para despegar al personaje del
// fondo, ojos emisivos reales para las skins con eyeGlow, y poses dedicadas para
// colgado/vuelo libre/parado/aterrizando. La regla dura sigue intacta: el héroe
// SIEMPRE vive en sceneZ = 0 (group.position = worldToScene(player.x, player.y),
// sin offset de Z) — solo el "shell" decorativo del rim light cuelga del mismo
// origen, nunca lo desplaza.
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { heroGroup, worldToScene, toonGradientMap, rimLight } from './world3d.js';
import * as state from './state.js';

const group = new THREE.Group();
heroGroup.add(group);

// Todo el cuerpo cuelga de bodyPivot: nos deja inclinar/escalar el personaje
// entero (tensión de la telaraña, lean de vuelo, squash de aterrizaje) sin
// tocar el punto de anclaje real (group.position === player en sceneZ=0).
const bodyPivot = new THREE.Group();
group.add(bodyPivot);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// materiales por skin
// ---------------------------------------------------------------------------
const materials = state.SKINS.map(s => ({
  torso:  new THREE.MeshToonMaterial({ color: s.torso,  gradientMap: toonGradientMap }),
  legs:   new THREE.MeshToonMaterial({ color: s.legs,   gradientMap: toonGradientMap }),
  accent: new THREE.MeshToonMaterial({ color: s.accent, gradientMap: toonGradientMap }),
  mask:   new THREE.MeshToonMaterial({
    color: s.mask, gradientMap: toonGradientMap,
    emissive: s.eyeGlow ? new THREE.Color(s.eyeColor || '#ffffff') : 0x000000,
    emissiveIntensity: s.eyeGlow ? 0.12 : 0,
  }),
  eyeGlow: s.eyeGlow ? new THREE.MeshBasicMaterial({ color: s.eyeColor || '#ffffff', toneMapped: false }) : null,
  eyeFlat: new THREE.MeshToonMaterial({ color: '#f0f0f4', gradientMap: toonGradientMap }),
  core: s.eyeGlow ? new THREE.MeshBasicMaterial({ color: s.eyeColor || '#ffffff', toneMapped: false, transparent: true, opacity: 0.9 }) : null,
}));

// shell de rim-light: un único material compartido (no depende de la skin),
// su color se actualiza cada frame desde rimLight — así el "borde de luz" del
// héroe realmente reacciona a la hora del día en vez de ser un tinte fijo.
const rimMat = new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.4,
  side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

// ---------------------------------------------------------------------------
// geometría — proporciones de héroe estilizado low-poly (cabeza más chica que
// el torso, hombros anchos, cintura angosta, brazos/piernas de dos segmentos)
// ---------------------------------------------------------------------------
// Nota de proporciones: player.radius (14, en state.js) es solo un radio de
// colisión de gameplay, no un bounding box visual — el mesh original (single-
// capsule) ya asentaba los pies ~10u por debajo de esa referencia al aterrizar
// y así quedó validado en la fase esqueleto. Con brazos/piernas de dos
// segmentos apuntamos a una silueta compacta y "chunky" (a tono con el low-poly
// premium cel-shaded, no realista-esbelto) que se queda cerca de esa misma
// profundidad de pie para no desalinear el aterrizaje.
const hipsGeo    = new THREE.CapsuleGeometry(5.6, 2, 3, 8);
const beltGeo     = new THREE.TorusGeometry(6, 0.9, 6, 14);
const torsoGeo    = new THREE.CylinderGeometry(7.6, 5.4, 13, 8, 1, false);
const deltoidGeo  = new THREE.SphereGeometry(3.2, 10, 8);
const headGeo     = new THREE.SphereGeometry(6.3, 14, 12);
const browGeo     = new THREE.BoxGeometry(7.2, 1.5, 2.1);
const shoulderGuardGeo = new THREE.ConeGeometry(3, 3.6, 6);

const upperArmGeo = new THREE.CapsuleGeometry(2.5, 4, 3, 6);
const forearmGeo  = new THREE.CapsuleGeometry(2.1, 4, 3, 6);
const handGeo     = new THREE.SphereGeometry(2.1, 8, 6);

const thighGeo = new THREE.CapsuleGeometry(2.8, 3, 3, 6);
const shinGeo  = new THREE.CapsuleGeometry(2.3, 3, 3, 6);
const footGeo  = new THREE.BoxGeometry(4.4, 2.2, 6.2);

const eyeGeo = new THREE.SphereGeometry(1.9, 10, 8);
const coreGeo = new THREE.SphereGeometry(1.5, 8, 8);

// tronco -------------------------------------------------------------------
const hips = new THREE.Mesh(hipsGeo, materials[0].torso);
hips.position.set(0, -8, 0);
const belt = new THREE.Mesh(beltGeo, materials[0].accent);
belt.position.set(0, -2, 0);
belt.rotation.x = Math.PI / 2;
const torso = new THREE.Mesh(torsoGeo, materials[0].torso);
torso.position.set(0, 5, 0);
const deltoidR = new THREE.Mesh(deltoidGeo, materials[0].accent);
deltoidR.position.set(8.2, 11, 0);
const deltoidL = new THREE.Mesh(deltoidGeo, materials[0].accent);
deltoidL.position.set(-8.2, 11, 0);
const shoulderGuard = new THREE.Mesh(shoulderGuardGeo, materials[0].accent);
shoulderGuard.position.set(8.2, 13, 0);
shoulderGuard.rotation.z = -0.35;

const core = new THREE.Mesh(coreGeo, materials[0].core || materials[0].accent);
core.position.set(0, 6, 7);

// cabeza (grupo propio para poder inclinarla independiente del torso) ------
const headGroup = new THREE.Group();
headGroup.position.set(0, 17, 0);
const head = new THREE.Mesh(headGeo, materials[0].mask);
head.scale.set(1, 1.05, 0.92);
const brow = new THREE.Mesh(browGeo, materials[0].accent);
brow.position.set(0, 1.2, 4.9);
brow.rotation.x = -0.12;
const eyeR = new THREE.Mesh(eyeGeo, materials[0].eyeFlat);
const eyeL = new THREE.Mesh(eyeGeo, materials[0].eyeFlat);
eyeR.scale.set(1.5, 1, 0.6);
eyeL.scale.set(1.5, 1, 0.6);
eyeR.position.set(2.5, 0.2, 5.0);
eyeL.position.set(-2.5, 0.2, 5.0);
eyeR.rotation.z = -0.18;
eyeL.rotation.z = 0.18;
headGroup.add(head, brow, eyeR, eyeL);

// brazos (hombro -> codo -> mano), pivots para poder posar cada segmento.
// Cada mesh se centra a mitad de su propio largo (length/2 + radius) y la
// siguiente articulación se ancla al largo completo, así no quedan huecos
// ni superposiciones raras entre segmentos.
function buildArm(sign){
  const shoulder = new THREE.Group();
  shoulder.position.set(8.4 * sign, 10.6, 0);
  const upperArm = new THREE.Mesh(upperArmGeo, materials[0].accent);
  upperArm.position.set(0, -4.5, 0);
  const elbow = new THREE.Group();
  elbow.position.set(0, -9, 0);
  const forearm = new THREE.Mesh(forearmGeo, materials[0].accent);
  forearm.position.set(0, -4.1, 0);
  const hand = new THREE.Mesh(handGeo, materials[0].accent);
  hand.position.set(0, -8.2, 0);
  elbow.add(forearm, hand);
  shoulder.add(upperArm, elbow);
  return { shoulder, elbow, upperArm, forearm, hand };
}
const armR = buildArm(1);
const armL = buildArm(-1);

// piernas (cadera -> rodilla -> pie) ----------------------------------------
function buildLeg(sign){
  const hip = new THREE.Group();
  hip.position.set(4 * sign, -11, 0);
  const thigh = new THREE.Mesh(thighGeo, materials[0].legs);
  thigh.position.set(0, -4.3, 0);
  const knee = new THREE.Group();
  knee.position.set(0, -8.6, 0);
  const shin = new THREE.Mesh(shinGeo, materials[0].legs);
  shin.position.set(0, -3.8, 0);
  const foot = new THREE.Mesh(footGeo, materials[0].legs);
  foot.position.set(0, -6.5, 1.5);
  knee.add(shin, foot);
  hip.add(thigh, knee);
  return { hip, knee, thigh, shin, foot };
}
const legR = buildLeg(1);
const legL = buildLeg(-1);

bodyPivot.add(
  hips, belt, torso, deltoidR, deltoidL, shoulderGuard, core, headGroup,
  armR.shoulder, armL.shoulder, legR.hip, legL.hip
);

// rim-light shell: copias ligeramente escaladas hacia afuera del torso/cabeza/
// cadera, cara interna visible (BackSide) con blending aditivo — el borde que
// asoma detrás de la silueta lee como luz de contorno real bajo el bloom.
function buildShell(geo, worldPosition, rotation, extraScale){
  const shell = new THREE.Mesh(geo, rimMat);
  shell.position.copy(worldPosition);
  if (rotation) shell.rotation.copy(rotation);
  shell.scale.copy(extraScale || { x: 1, y: 1, z: 1 }).multiplyScalar(1.08);
  shell.castShadow = false;
  shell.receiveShadow = false;
  return shell;
}
bodyPivot.add(
  buildShell(torsoGeo, torso.position),
  buildShell(headGeo, headGroup.position, head.rotation, head.scale),
  buildShell(hipsGeo, hips.position),
);

[hips, belt, torso, deltoidR, deltoidL, shoulderGuard, head, brow,
  armR.upperArm, armR.forearm, armR.hand, armL.upperArm, armL.forearm, armL.hand,
  legR.thigh, legR.shin, legR.foot, legL.thigh, legL.shin, legL.foot,
].forEach(m => { m.castShadow = true; m.receiveShadow = true; });

// ---------------------------------------------------------------------------
// aplicar skin
// ---------------------------------------------------------------------------
let currentSkin = -1;
let skinScale = 1;
function applySkin(i){
  if (i === currentSkin) return;
  currentSkin = i;
  const m = materials[i];
  const s = state.SKINS[i];

  torso.material = m.torso;
  hips.material = m.torso;
  belt.material = m.accent;
  deltoidR.material = deltoidL.material = m.accent;
  shoulderGuard.material = m.accent;
  head.material = m.mask;
  brow.material = m.accent;

  [armR, armL].forEach(a => { a.upperArm.material = a.forearm.material = a.hand.material = m.accent; });
  [legR, legL].forEach(l => { l.thigh.material = l.shin.material = l.foot.material = m.legs; });

  const eyeMat = s.eyeGlow ? m.eyeGlow : m.eyeFlat;
  eyeR.material = eyeMat;
  eyeL.material = eyeMat;

  core.visible = !!s.eyeGlow;
  if (s.eyeGlow) core.material = m.core;

  // pequeño toque de identidad por skin, sin romper la silueta genérica:
  // "sigilo" más compacto, "dorado" un poco más ancho de hombros.
  skinScale = s.id === 'stealth' ? 0.94 : (s.id === 'tech' ? 1.03 : 1);
}

// ---------------------------------------------------------------------------
// animación / pose
// ---------------------------------------------------------------------------
let wasGrounded = true;
let landTimer = 0;

export function update(){
  const p = state.player;
  if (!p) return;
  applySkin(state.selectedSkin);

  const pos = worldToScene(p.x, p.y);
  group.position.copy(pos);
  group.scale.x = p.facing >= 0 ? 1 : -1;

  // rim shell: color/intensidad reales de rimLight, no un tinte fijo
  rimMat.color.copy(rimLight.color);
  rimMat.opacity = clamp(0.28 + rimLight.intensity * 0.28, 0.18, 0.6);

  const now = performance.now();
  const vx = p.x - (p.px !== undefined ? p.px : p.x);
  const vy = p.y - (p.py !== undefined ? p.py : p.y);

  if (p.grounded && !wasGrounded) landTimer = 12;
  wasGrounded = p.grounded;
  if (landTimer > 0) landTimer--;
  const land = landTimer / 12; // 1 -> 0, squash de aterrizaje

  let lean = 0;

  if (state.web.active && state.web.anchor){
    // colgado de la telaraña: el brazo apunta al anchor real y el torso entero
    // se inclina un poco hacia esa dirección para que se lea como tensión
    // física del hilo, no como un brazo suelto rotando en el aire.
    const facing = p.facing >= 0 ? 1 : -1;
    const ang = Math.atan2(state.web.anchor.y - p.y, (state.web.anchor.x - p.x) * facing);
    armR.shoulder.rotation.z = -ang;
    armR.elbow.rotation.z = -0.4;
    armL.shoulder.rotation.z = 0.85;
    armL.elbow.rotation.z = -0.55;

    lean = clamp(-ang * 0.16, -0.45, 0.45);

    const st = now / 260;
    legR.hip.rotation.z = -0.55 + Math.sin(st) * 0.08;
    legL.hip.rotation.z = -0.35 - Math.sin(st) * 0.08;
    legR.knee.rotation.z = -0.95;
    legL.knee.rotation.z = -0.7;

    headGroup.rotation.z = lean * 0.4;
  } else if (!p.grounded){
    // vuelo libre (salto, caída, después de soltar la telaraña): postura
    // dinámica de carrera aérea en vez de un tijereteo simétrico plano.
    const t = now / 300;
    const cycle = Math.sin(t);
    legR.hip.rotation.z = cycle * 0.55;
    legL.hip.rotation.z = -cycle * 0.55;
    legR.knee.rotation.z = Math.max(0, -cycle) * 0.9 + 0.15;
    legL.knee.rotation.z = Math.max(0, cycle) * 0.9 + 0.15;

    armR.shoulder.rotation.z = -cycle * 0.5 - 0.15;
    armL.shoulder.rotation.z = cycle * 0.5 + 0.15;
    armR.elbow.rotation.z = -0.5;
    armL.elbow.rotation.z = -0.5;

    lean = clamp(-vx * 0.03, -0.3, 0.3) + clamp(-vy * 0.01, -0.15, 0.15);
    headGroup.rotation.z = lean * 0.3;
  } else {
    // parado / aterrizando: caminata si hay input horizontal, si no, idle
    // con respiración sutil.
    const moving = state.keys && (state.keys.left || state.keys.right);
    if (moving){
      const wt = now / 140;
      legR.hip.rotation.z = Math.sin(wt) * 0.5;
      legL.hip.rotation.z = -Math.sin(wt) * 0.5;
      legR.knee.rotation.z = Math.max(0, Math.sin(wt + 1.4)) * 0.7;
      legL.knee.rotation.z = Math.max(0, Math.sin(wt + 1.4 + Math.PI)) * 0.7;
      armR.shoulder.rotation.z = -Math.sin(wt) * 0.4 + 0.25;
      armL.shoulder.rotation.z = Math.sin(wt) * 0.4 - 0.25;
      armR.elbow.rotation.z = armL.elbow.rotation.z = -0.5;
    } else {
      const breathe = Math.sin(now / 900) * 0.02;
      legR.hip.rotation.z = 0.06;
      legL.hip.rotation.z = -0.06;
      legR.knee.rotation.z = 0.12;
      legL.knee.rotation.z = 0.12;
      armR.shoulder.rotation.z = 0.32 + breathe;
      armL.shoulder.rotation.z = -0.4 - breathe;
      armR.elbow.rotation.z = -0.35;
      armL.elbow.rotation.z = -0.45;
    }
    headGroup.rotation.z = 0;
  }

  bodyPivot.rotation.z = lean;

  const squashY = 1 - land * 0.22;
  const squashXZ = 1 + land * 0.14;
  bodyPivot.scale.set(skinScale * squashXZ, skinScale * squashY, skinScale * squashXZ);
}

export function getWorldEyePosition(){
  const p = state.player;
  return p ? { x: p.x, y: p.y - 17 } : { x: 0, y: 0 };
}
