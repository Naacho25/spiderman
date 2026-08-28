// ============================================================================
// Héroe: mesh procedural + animación procedural. Fase 3 (pase anatómico) —
// sobre la silueta compuesta ya validada (torso ahusado, hombros, brazos/
// piernas de dos segmentos) se suma: un torso "lathe" con perfil real de
// pecho/cintura (V-taper marcado + bulto pectoral en la silueta misma, sin
// geometría extra ni emblemas), más contraste bíceps/antebrazo y muslo/
// pantorrilla, un pivot de columna (chestPivot) que separa el pecho de la
// cadera para que el arqueo de espalda y la inclinación al colgar sean curva
// real y no un torso rígido, cabeza que gira hacia el punto de interés.
// Fase 5 (pase cartoon plano, look Jetpack Joyride): se abandona el PBR
// realista de la fase anterior (MeshPhysicalMaterial, normal map de tela,
// roughness map, sheen) a favor de MeshStandardMaterial simple — color
// sólido por pieza del cuerpo, sin ruido de superficie, metalness 0 y
// roughness alto y parejo (0.85-0.95) para que el sombreado no le meta
// brillo/variación "realista". El contorno negro grueso (post-proceso en
// world3d.js) es el que hace la lectura de "dibujo", no la superficie. El
// "rim light shell" (mesh clonado hacia afuera, BackSide + AdditiveBlending)
// es un efecto aditivo aparte y sigue intacto. La regla dura sigue intacta:
// el héroe SIEMPRE vive
// en sceneZ = 0 (group.position = worldToScene(player.x, player.y), sin
// offset de Z) — solo el "shell" decorativo del rim light cuelga del mismo
// origen, nunca lo desplaza.
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { heroGroup, worldToScene, rimLight } from './world3d.js';
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
// saturación: sube un poco la saturación percibida de un color de skin sin
// tocar state.js — usado para cinturón/acentos, que al lado de un traje muy
// plano y vivo quedaban "apagados" si se usaba el color crudo de la skin.
// ---------------------------------------------------------------------------
function boostSaturation(hex, amount){
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.s = clamp(hsl.s + amount, 0, 1);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

// ---------------------------------------------------------------------------
// materiales por skin — look cartoon plano (referencia: Jetpack Joyride),
// ya no tela PBR realista. Sin normal map de micro-arrugas ni roughness map
// de variación de tono: cada pieza del cuerpo lee como un color sólido y
// parejo, y es el contorno negro (post-proceso en world3d.js) el que hace el
// trabajo de "dibujo", no la superficie. roughness alto y parejo (0.85-0.95)
// en todas las piezas para que el sombreado del sol/rim light no le meta
// brillo ni variación de "tela real" — metalness en 0 en todo el traje. Los
// ojos emisivos (skins con eyeGlow) siguen siendo MeshBasicMaterial sin
// cambios — ese comportamiento de "fuente de luz" no se toca acá.
// ---------------------------------------------------------------------------
function suitMaterial(color, { roughness, metalness = 0 } = {}){
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

const materials = state.SKINS.map(s => ({
  // traje: torso/piernas mate y sólido, sin sheen de tela ni ruido de superficie.
  torso:  suitMaterial(s.torso, { roughness: 0.90, metalness: 0 }),
  legs:   suitMaterial(s.legs,  { roughness: 0.92, metalness: 0 }),
  // acento (mangas/hombros/detalles): color con saturación reforzada para que
  // no quede apagado al lado del traje.
  accent: suitMaterial(boostSaturation(s.accent, 0.12), { roughness: 0.88, metalness: 0 }),
  // máscara: mismo plano de color, sin variación de arruga (más ceñida).
  mask: (() => {
    const m = suitMaterial(s.mask, { roughness: 0.85, metalness: 0 });
    m.emissive = s.eyeGlow ? new THREE.Color(s.eyeColor || '#ffffff') : new THREE.Color(0x000000);
    m.emissiveIntensity = s.eyeGlow ? 0.12 : 0;
    return m;
  })(),
  // cinturón: mismo look plano/mate que el resto, sin grano de cuero ni
  // metalness — color con saturación reforzada, igual que el acento.
  belt: new THREE.MeshStandardMaterial({
    color: boostSaturation(s.accent, 0.12), roughness: 0.88, metalness: 0,
  }),
  eyeGlow: s.eyeGlow ? new THREE.MeshBasicMaterial({ color: s.eyeColor || '#ffffff', toneMapped: false }) : null,
  // ojos no-emisivos: lente clara, algo brillante (no fabric, no toon).
  eyeFlat: new THREE.MeshStandardMaterial({ color: '#f0f0f4', roughness: 0.3, metalness: 0.05 }),
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
// geometría — proporciones de héroe atlético estilizado (cabeza más chica que
// el torso, hombros notablemente más anchos que la cintura, bíceps más grueso
// que el antebrazo, muslo más grueso que la pantorrilla).
// ---------------------------------------------------------------------------
// Nota de proporciones: player.radius (14, en state.js) es solo un radio de
// colisión de gameplay, no un bounding box visual. La cadena pierna
// (cadera->rodilla->pie) fue recalibrada para engrosar el muslo y afinar la
// pantorrilla, pero la distancia total cadera->planta del pie se mantuvo casi
// idéntica a la fase anterior (~16u) a propósito, para no desalinear el punto
// de contacto visual con el suelo al aterrizar.
const hipsGeo    = new THREE.CapsuleGeometry(5.6, 2, 3, 8);
const beltGeo     = new THREE.TorusGeometry(5.3, 0.85, 6, 14);
// torso "lathe": perfil real cintura->costillas->pecho->clavícula en vez de
// un cono liso — el bulto en el medio (pecho) y el afinado en la base
// (cintura) leen como volumen muscular sugerido, sin geometría separada.
const torsoGeo = new THREE.LatheGeometry([
  new THREE.Vector2(4.6, -4.0),  // dobladillo / cintura
  new THREE.Vector2(5.2, -1.5),  // costillas bajas
  new THREE.Vector2(7.0, 1.4),   // ensanche hacia el pecho
  new THREE.Vector2(8.1, 3.9),   // pico pectoral (punto más ancho)
  new THREE.Vector2(7.4, 6.2),   // pecho alto / hacia la clavícula
  new THREE.Vector2(6.4, 8.6),   // base del hombro (clavícula)
], 8);
const deltoidGeo  = new THREE.SphereGeometry(3.5, 10, 8);
const headGeo     = new THREE.SphereGeometry(6.3, 14, 12);
const browGeo     = new THREE.BoxGeometry(7.2, 1.5, 2.1);
const shoulderGuardGeo = new THREE.ConeGeometry(3.2, 3.8, 6);

// bíceps notablemente más grueso que el antebrazo (antes casi iguales).
const upperArmGeo = new THREE.CapsuleGeometry(2.9, 4.4, 3, 8);
const forearmGeo  = new THREE.CapsuleGeometry(2.0, 4.2, 3, 8);
const handGeo     = new THREE.SphereGeometry(2.3, 8, 6);

// muslo notablemente más grueso que la pantorrilla (largo total muslo+
// pantorrilla ~igual a la fase anterior, ver nota arriba).
const thighGeo = new THREE.CapsuleGeometry(3.2, 2.6, 3, 8);
const shinGeo  = new THREE.CapsuleGeometry(1.9, 3.2, 3, 8);
const footGeo  = new THREE.BoxGeometry(4.6, 2.3, 6.4);

const eyeGeo = new THREE.SphereGeometry(1.9, 10, 8);
const coreGeo = new THREE.SphereGeometry(1.5, 8, 8);

// tronco -------------------------------------------------------------------
const hips = new THREE.Mesh(hipsGeo, materials[0].torso);
hips.position.set(0, -8, 0);
const belt = new THREE.Mesh(beltGeo, materials[0].belt);
belt.position.set(0, -2, 0);
belt.rotation.x = Math.PI / 2;

// chestPivot: pivot de columna independiente de la cadera. Todo lo que va
// "arriba de la cintura" (torso, hombros, brazos, cabeza) cuelga de acá, así
// el pecho puede arquearse/inclinarse con curva real sin arrastrar cadera ni
// piernas — esa era la limitación de la fase anterior (torso rígido).
const chestPivot = new THREE.Group();
chestPivot.position.set(0, 2, 0);

const torso = new THREE.Mesh(torsoGeo, materials[0].torso);
torso.position.set(0, 0, 0);
const deltoidR = new THREE.Mesh(deltoidGeo, materials[0].accent);
deltoidR.position.set(9.1, 9.0, 0);
const deltoidL = new THREE.Mesh(deltoidGeo, materials[0].accent);
deltoidL.position.set(-9.1, 9.0, 0);
const shoulderGuard = new THREE.Mesh(shoulderGuardGeo, materials[0].accent);
shoulderGuard.position.set(9.1, 10.8, 0);
shoulderGuard.rotation.z = -0.35;

const core = new THREE.Mesh(coreGeo, materials[0].core || materials[0].accent);
core.position.set(0, 3.9, 7);

// cabeza (grupo propio para poder inclinarla independiente del torso) ------
const headGroup = new THREE.Group();
headGroup.position.set(0, 14.3, 0);
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
  shoulder.position.set(9.3 * sign, 8.6, 0);
  const upperArm = new THREE.Mesh(upperArmGeo, materials[0].accent);
  upperArm.position.set(0, -5.1, 0);
  const elbow = new THREE.Group();
  elbow.position.set(0, -10.2, 0);
  const forearm = new THREE.Mesh(forearmGeo, materials[0].accent);
  forearm.position.set(0, -4.1, 0);
  const hand = new THREE.Mesh(handGeo, materials[0].accent);
  hand.position.set(0, -8.2, 0);
  // mano ligeramente achatada/alargada en vez de bocha esférica genérica.
  hand.scale.set(1, 1.15, 0.75);
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
  thigh.position.set(0, -4.5, 0);
  const knee = new THREE.Group();
  knee.position.set(0, -9.0, 0);
  const shin = new THREE.Mesh(shinGeo, materials[0].legs);
  shin.position.set(0, -3.5, 0);
  const foot = new THREE.Mesh(footGeo, materials[0].legs);
  foot.position.set(0, -6.0, 1.5);
  knee.add(shin, foot);
  hip.add(thigh, knee);
  return { hip, knee, thigh, shin, foot };
}
const legR = buildLeg(1);
const legL = buildLeg(-1);

chestPivot.add(
  torso, deltoidR, deltoidL, shoulderGuard, core, headGroup,
  armR.shoulder, armL.shoulder
);
bodyPivot.add(hips, belt, chestPivot, legR.hip, legL.hip);

// rim-light shell: copias ligeramente escaladas hacia afuera del torso/cabeza/
// hombros/cadera, cara interna visible (BackSide) con blending aditivo — el
// borde que asoma detrás de la silueta lee como luz de contorno real bajo el
// bloom. Mismo material/helper que la fase anterior, solo se reusa para los
// hombros (ahora más anchos) además de torso/cabeza/cadera.
function buildShell(geo, worldPosition, rotation, extraScale){
  const shell = new THREE.Mesh(geo, rimMat);
  shell.position.copy(worldPosition);
  if (rotation) shell.rotation.copy(rotation);
  shell.scale.copy(extraScale || { x: 1, y: 1, z: 1 }).multiplyScalar(1.08);
  shell.castShadow = false;
  shell.receiveShadow = false;
  return shell;
}
chestPivot.add(
  buildShell(torsoGeo, torso.position),
  buildShell(headGeo, headGroup.position, head.rotation, head.scale),
  buildShell(deltoidGeo, deltoidR.position),
  buildShell(deltoidGeo, deltoidL.position),
);
bodyPivot.add(
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
  belt.material = m.belt;
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
    // colgado de la telaraña: el brazo apunta al anchor real y el CUERPO
    // ENTERO se inclina hacia esa dirección, pero no como bloque rígido —
    // el pecho (chestPivot) inclina más que la cadera/piernas, como si el
    // tirón del hilo pasara primero por el torso superior, y además se
    // pliega levemente hacia adelante (peso colgando de un solo brazo) en
    // vez de quedar parado en el aire.
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

    chestPivot.rotation.z = lean * 0.55;
    chestPivot.rotation.x = 0.18 + Math.abs(lean) * 0.12;

    headGroup.rotation.z = lean * 0.35;
    headGroup.rotation.x = clamp(-ang * 0.2, -0.35, 0.35);
  } else if (!p.grounded){
    // vuelo libre (salto, caída, después de soltar la telaraña): postura
    // dinámica de carrera aérea en vez de un tijereteo simétrico plano, con
    // arqueo real de columna (pecho arriba/atrás al subir, se pliega hacia
    // adelante al caer) en vez de un torso rígido siguiendo a las extremidades.
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

    const vyArch = clamp(-vy * 0.05, -0.3, 0.3);
    chestPivot.rotation.x = -0.15 + vyArch;
    chestPivot.rotation.z = lean * 0.4 + Math.sin(t * 0.5) * 0.04;

    headGroup.rotation.z = lean * 0.3;
    headGroup.rotation.x = clamp(vy * 0.02, -0.25, 0.25);
  } else {
    // parado / aterrizando: caminata si hay input horizontal, si no, idle
    // con respiración sutil (ahora visible como leve sube-baja del pecho,
    // no solo de los brazos).
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

      chestPivot.rotation.z = Math.sin(wt) * 0.06;
      chestPivot.rotation.x = 0.02;
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

      chestPivot.rotation.z = 0;
      chestPivot.rotation.x = 0.03 + breathe * 1.5;
    }
    headGroup.rotation.z = 0;
    headGroup.rotation.x = 0;
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
