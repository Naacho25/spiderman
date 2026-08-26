// ============================================================================
// Enemigos en 3D — Fase 2 (pase de arte). Cada tipo se arma como un pequeño
// grupo de 2-4 formas simples (igual criterio que hero.js) para tener una
// silueta reconocible, en vez de una única primitiva genérica. Mismo criterio
// anti-copyright que regía en la versión 2D (index-2d-legacy-backup.html):
// siluetas y paletas propias que EVOCAN el concepto, nada calcado de Marvel.
//
// Patrón de pool sin cambios: una Map por objeto de estado -> registro de
// mesh(es), creado una sola vez y reposicionado cada frame. Lo único que
// cambia respecto de la Fase 1 es que el pool ahora guarda un pequeño "rig"
// (grupo raíz + referencias a sus partes) en vez de un mesh suelto, para
// poder animar partes individuales (brazos, cola, rotor...) sin recrear
// geometría en update().
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { enemyGroup, worldToScene, toonGradientMap } from './world3d.js';
import * as state from './state.js';

function toon(color){ return new THREE.MeshToonMaterial({ color, gradientMap: toonGradientMap }); }
function basic(color){ return new THREE.MeshBasicMaterial({ color }); }
function glowMat(color){
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
}

const MAT = {
  goblin: {
    board: toon('#1a2b14'),
    body: toon('#357a2c'),
    hood: toon('#16240f'),
    eye: basic('#ffe066'),
    glow: glowMat('#78ff5a'),
  },
  climber: {
    torso: toon('#3a3f47'),
    arm: toon('#8b929c'),
    leg: toon('#23262b'),
    lens: basic('#ff3b3b'),
    glow: glowMat('#ff3c3c'),
  },
  rhino: {
    body: toon('#5b6570'),
    plate: toon('#3a4148'),
    horn: toon('#d8d0c0'),
    eye: basic('#ff5a3c'),
  },
  sand: {
    body: toon('#c9a56b'),
    dark: toon('#8a6a42'),
  },
  scorpion: {
    body: toon('#1c3324'),
    tail: toon('#274a34'),
    stinger: basic('#8aff6a'),
    eye: basic('#ffe066'),
  },
  crane: {
    metal: toon('#5a5f66'),
    dark: toon('#3d4147'),
    hook: toon('#ffd166'),
    glow: glowMat('#ffd166'),
  },
  heli: {
    body: toon('#2b3a4a'),
    bodyRiding: toon('#c0272d'),
    cockpit: new THREE.MeshToonMaterial({ color: '#b4dcff', gradientMap: toonGradientMap, transparent: true, opacity: 0.85 }),
    rotor: toon('#cfd6dd'),
    skid: toon('#1a1f26'),
  },
};

function pool(makeFn){
  const byObj = new Map();
  return {
    get(obj){
      let rec = byObj.get(obj);
      if (!rec){ rec = makeFn(); enemyGroup.add(rec.root); byObj.set(obj, rec); }
      return rec;
    },
    sweep(liveList){
      const alive = new Set(liveList);
      for (const [obj, rec] of byObj){
        if (!alive.has(obj)){ enemyGroup.remove(rec.root); byObj.delete(obj); }
      }
    }
  };
}

function shadow(...meshes){ for (const m of meshes) m.castShadow = true; }

// ---------------------------------------------------------------------------
// Villano volador ("goblin"): silueta propia — tabla voladora + figura
// encapuchada verde oscuro, ojos brillantes. Nada de máscara/traje calcado.
// ---------------------------------------------------------------------------
const goblinGeo = {
  board: new THREE.BoxGeometry(34, 3.5, 12),
  body: new THREE.CapsuleGeometry(6, 9, 3, 6),
  hood: new THREE.ConeGeometry(7.2, 15, 6),
  arm: new THREE.CapsuleGeometry(2, 12, 2, 5),
  eye: new THREE.SphereGeometry(1.3, 6, 5),
  glow: new THREE.CircleGeometry(28, 16),
};
function makeGoblin(){
  const root = new THREE.Group();
  const glow = new THREE.Mesh(goblinGeo.glow, MAT.goblin.glow);
  glow.position.z = -10;
  const board = new THREE.Mesh(goblinGeo.board, MAT.goblin.board);
  board.position.set(0, -11, 0);
  const body = new THREE.Mesh(goblinGeo.body, MAT.goblin.body);
  body.position.set(0, -1, 0);
  const hood = new THREE.Mesh(goblinGeo.hood, MAT.goblin.hood);
  hood.position.set(0, 10, 0);
  const armR = new THREE.Mesh(goblinGeo.arm, MAT.goblin.body);
  armR.position.set(9, 2, 0); armR.rotation.z = -0.65;
  const armL = new THREE.Mesh(goblinGeo.arm, MAT.goblin.body);
  armL.position.set(-9, 4, 0); armL.rotation.z = 0.5;
  const eyeR = new THREE.Mesh(goblinGeo.eye, MAT.goblin.eye);
  eyeR.position.set(2.4, 11, 6);
  const eyeL = new THREE.Mesh(goblinGeo.eye, MAT.goblin.eye);
  eyeL.position.set(-2.4, 11, 6);
  root.add(glow, board, body, hood, armR, armL, eyeR, eyeL);
  shadow(board, body, hood, armR, armL);
  return { root, board, body, hood, armR, armL };
}
const goblinPool = pool(makeGoblin);

// ---------------------------------------------------------------------------
// Trepador mecánico: exo-traje con 4 brazos mecánicos desde los hombros (ya
// decidido en el proyecto para que no se lea como araña), lente rojo único.
// ---------------------------------------------------------------------------
const climberGeo = {
  torso: new THREE.CapsuleGeometry(9, 13, 3, 6),
  head: new THREE.SphereGeometry(7, 10, 8),
  lens: new THREE.SphereGeometry(2.4, 8, 6),
  arm: new THREE.CapsuleGeometry(2.1, 11, 2, 5),
  leg: new THREE.CapsuleGeometry(2.5, 7, 2, 5),
  glow: new THREE.CircleGeometry(30, 16),
};
function makeArm(){
  const m = new THREE.Mesh(climberGeo.arm, MAT.climber.arm);
  m.castShadow = true;
  return m;
}
function makeClimber(){
  const root = new THREE.Group();
  const glow = new THREE.Mesh(climberGeo.glow, MAT.climber.glow);
  glow.position.z = -12;
  const torso = new THREE.Mesh(climberGeo.torso, MAT.climber.torso);
  const head = new THREE.Mesh(climberGeo.head, MAT.climber.torso);
  head.position.set(0, 17, 2);
  const lens = new THREE.Mesh(climberGeo.lens, MAT.climber.lens);
  lens.position.set(0, 17, 6.5); lens.scale.set(1, 0.7, 0.6);
  const legR = new THREE.Mesh(climberGeo.leg, MAT.climber.leg);
  legR.position.set(4, -14, 2); legR.rotation.z = -0.3;
  const legL = new THREE.Mesh(climberGeo.leg, MAT.climber.leg);
  legL.position.set(-4, -14, 2); legL.rotation.z = 0.3;
  // 4 brazos: hombros arriba/abajo por costado, con leve profundidad Z distinta
  // para dar volumen (permitido: solo el gancho de grúa y el helicóptero deben
  // quedar exactamente en z=0).
  const armTR = makeArm(); armTR.position.set(8, 9, 4);
  const armBR = makeArm(); armBR.position.set(8, -5, 4);
  const armTL = makeArm(); armTL.position.set(-8, 9, -4);
  const armBL = makeArm(); armBL.position.set(-8, -5, -4);
  root.add(glow, torso, head, lens, legR, legL, armTR, armBR, armTL, armBL);
  shadow(torso, head, legR, legL);
  return { root, torso, head, lens, armTR, armBR, armTL, armBL };
}
const climberPool = pool(makeClimber);

// ---------------------------------------------------------------------------
// Rhino: silueta bruta y blindada con cuerno frontal — no es un rinoceronte
// realista ni el traje del personaje real.
// ---------------------------------------------------------------------------
const rhinoGeo = {
  body: new THREE.CapsuleGeometry(15, 24, 4, 8),
  plate: new THREE.BoxGeometry(28, 8, 20),
  head: new THREE.SphereGeometry(12, 10, 8),
  horn: new THREE.ConeGeometry(6, 20, 6),
  leg: new THREE.BoxGeometry(9, 15, 11),
  eye: new THREE.SphereGeometry(2, 6, 5),
};
function makeRhino(){
  const root = new THREE.Group();
  const body = new THREE.Mesh(rhinoGeo.body, MAT.rhino.body);
  body.rotation.z = Math.PI / 2; // capsula acostada = torso macizo
  body.position.set(-2, 4, 0);
  const plate = new THREE.Mesh(rhinoGeo.plate, MAT.rhino.plate);
  plate.position.set(-4, 15, 0);
  const head = new THREE.Mesh(rhinoGeo.head, MAT.rhino.body);
  head.position.set(21, 5, 0);
  const horn = new THREE.Mesh(rhinoGeo.horn, MAT.rhino.horn);
  horn.position.set(31, 5, 0);
  horn.rotation.z = -Math.PI / 2 + 0.35; // apunta hacia adelante (+x, dirección de carrera)
  const eye = new THREE.Mesh(rhinoGeo.eye, MAT.rhino.eye);
  eye.position.set(26, 8, 8);
  const legF = new THREE.Mesh(rhinoGeo.leg, MAT.rhino.plate);
  legF.position.set(10, -12, 6);
  const legB = new THREE.Mesh(rhinoGeo.leg, MAT.rhino.plate);
  legB.position.set(-14, -12, -6);
  root.add(body, plate, head, horn, eye, legF, legB);
  shadow(body, plate, head, legF, legB);
  return { root, legF, legB };
}
const rhinoPool = pool(makeRhino);

// ---------------------------------------------------------------------------
// Mano de arena: brazo/mano gigante granular que emerge del piso. La
// geometría local ocupa de y=-30 (base, al ras del piso) a y=+30 (puntas de
// los dedos) para que el scale.y calculado en update() (igual criterio que la
// Fase 1) siga funcionando sin tocar la fórmula.
// ---------------------------------------------------------------------------
const sandGeo = {
  forearm: new THREE.CylinderGeometry(9, 13, 32, 6),
  palm: new THREE.SphereGeometry(13, 8, 6),
  finger: new THREE.CylinderGeometry(1.6, 4.2, 22, 5),
  grain: new THREE.IcosahedronGeometry(2.4, 0),
};
const FINGER_LAYOUT = [
  { x: -17, len: 22, tilt: -0.22 },
  { x: -6,  len: 27, tilt: -0.06 },
  { x: 5,   len: 27, tilt: 0.06 },
  { x: 16,  len: 21, tilt: 0.24 },
];
function makeSandHand(){
  const root = new THREE.Group();
  const forearm = new THREE.Mesh(sandGeo.forearm, MAT.sand.dark);
  forearm.position.set(0, -14, 0);
  const palm = new THREE.Mesh(sandGeo.palm, MAT.sand.body);
  palm.position.set(0, 4, 0); palm.scale.set(1, 0.85, 0.75);
  root.add(forearm, palm);
  const fingers = FINGER_LAYOUT.map(f => {
    const finger = new THREE.Mesh(sandGeo.finger, MAT.sand.body);
    finger.position.set(f.x, 4 + f.len / 2, 0);
    finger.rotation.z = f.tilt;
    root.add(finger);
    return finger;
  });
  // grumos de arena para lectura "granular", no una superficie lisa
  const grains = [];
  const grainSpots = [[-9, -6, 8], [7, -10, -7], [0, 8, 9], [-12, 10, -6], [10, 6, 7]];
  for (const [gx, gy, gz] of grainSpots){
    const g = new THREE.Mesh(sandGeo.grain, MAT.sand.dark);
    g.position.set(gx, gy, gz);
    root.add(g);
    grains.push(g);
  }
  shadow(forearm, palm, ...fingers);
  return { root, forearm, palm, fingers, grains };
}
const sandPool = pool(makeSandHand);

// ---------------------------------------------------------------------------
// Escorpión: cuerpo compacto + cola segmentada que se arquea sobre el
// "hombro" (de ahí dispara el veneno), aguijón brillante.
// ---------------------------------------------------------------------------
const scorpionGeo = {
  body: new THREE.SphereGeometry(11, 10, 8),
  seg: new THREE.CapsuleGeometry(2.6, 7, 2, 5),
  stinger: new THREE.ConeGeometry(3, 7, 6),
  eye: new THREE.SphereGeometry(1.4, 6, 5),
};
function makeScorpion(){
  const root = new THREE.Group();
  const body = new THREE.Mesh(scorpionGeo.body, MAT.scorpion.body);
  body.scale.set(1, 0.75, 0.9);
  const eyeR = new THREE.Mesh(scorpionGeo.eye, MAT.scorpion.eye);
  eyeR.position.set(-3, 2, 9);
  const eyeL = new THREE.Mesh(scorpionGeo.eye, MAT.scorpion.eye);
  eyeL.position.set(3, 2, 9);
  // cola: cadena de 3 segmentos con rotaciones fijas crecientes -> arco sobre
  // el hombro, como un brazo articulado FK simple (mismo espíritu que los
  // brazos del climber, sin animar hueso a hueso cada frame).
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-2, 4, -2);
  let cursor = tailPivot;
  const segs = [];
  const segAngles = [-0.9, -1.3, -1.5];
  const segLens = [9, 8, 7];
  for (let i = 0; i < 3; i++){
    const pivot = new THREE.Group();
    pivot.rotation.z = segAngles[i];
    cursor.add(pivot);
    const seg = new THREE.Mesh(scorpionGeo.seg, MAT.scorpion.tail);
    seg.position.y = segLens[i] / 2;
    pivot.add(seg);
    segs.push(seg);
    const next = new THREE.Group();
    next.position.y = segLens[i];
    pivot.add(next);
    cursor = next;
  }
  const stinger = new THREE.Mesh(scorpionGeo.stinger, MAT.scorpion.stinger);
  stinger.position.y = 4;
  cursor.add(stinger);
  root.add(body, eyeR, eyeL, tailPivot);
  shadow(body, ...segs);
  return { root, body, tailPivot, stinger };
}
const scorpionPool = pool(makeScorpion);

// ---------------------------------------------------------------------------
// Grúa (solo el gancho): gancho industrial simple. El punto de contacto
// (root.position) queda exactamente en worldToScene(hookX, hookY) -> z=0,
// porque el jugador se engancha por raycast contra ese punto. La decoración
// (roldana) puede asomar levemente en Z, el gancho en sí se mantiene al ras.
// ---------------------------------------------------------------------------
const craneGeo = {
  pulley: new THREE.BoxGeometry(9, 7, 7),
  shaft: new THREE.CylinderGeometry(1.4, 1.4, 12, 6),
  hook: new THREE.TorusGeometry(6.5, 1.8, 6, 10, Math.PI * 1.5),
  glow: new THREE.CircleGeometry(18, 14),
};
function makeCrane(){
  const root = new THREE.Group();
  const glow = new THREE.Mesh(craneGeo.glow, MAT.crane.glow);
  glow.position.z = -6;
  const pulley = new THREE.Mesh(craneGeo.pulley, MAT.crane.dark);
  pulley.position.set(0, 9, 2);
  const shaft = new THREE.Mesh(craneGeo.shaft, MAT.crane.metal);
  shaft.position.set(0, 3, 0);
  const hook = new THREE.Mesh(craneGeo.hook, MAT.crane.hook);
  hook.position.set(0, -5, 0);
  hook.rotation.z = Math.PI * 0.75; // abre hacia arriba, forma de "J"
  root.add(glow, pulley, shaft, hook);
  shadow(pulley, shaft, hook);
  return { root, hook };
}
const cranePool = pool(makeCrane);

// ---------------------------------------------------------------------------
// Helicóptero de ayuda: el único que puede leer "literal" (vehículo genérico,
// sin copyright de personaje). Fuselaje + cabina + cola + rotor animado.
// ---------------------------------------------------------------------------
const heliGeo = {
  body: new THREE.CapsuleGeometry(9, 16, 3, 8),
  cockpit: new THREE.SphereGeometry(7, 10, 8),
  tailBoom: new THREE.CylinderGeometry(1.6, 2.6, 26, 6),
  tailFin: new THREE.ConeGeometry(4.5, 9, 4),
  rotorBlade: new THREE.BoxGeometry(38, 1, 3.2),
  tailRotorBlade: new THREE.BoxGeometry(1.6, 10, 1.6),
  hub: new THREE.CylinderGeometry(1.4, 1.4, 3, 6),
  skid: new THREE.CylinderGeometry(1.2, 1.2, 30, 5),
  strut: new THREE.CylinderGeometry(1, 1, 8, 5),
};
function makeHeli(){
  const root = new THREE.Group();
  const body = new THREE.Mesh(heliGeo.body, MAT.heli.body);
  body.rotation.z = Math.PI / 2;
  const cockpit = new THREE.Mesh(heliGeo.cockpit, MAT.heli.cockpit);
  cockpit.position.set(12, -2, 0); cockpit.scale.set(0.9, 0.8, 0.85);
  const tailBoom = new THREE.Mesh(heliGeo.tailBoom, MAT.heli.body);
  tailBoom.rotation.z = Math.PI / 2;
  tailBoom.position.set(-28, 3, 0);
  const tailFin = new THREE.Mesh(heliGeo.tailFin, MAT.heli.body);
  tailFin.rotation.z = Math.PI / 2;
  tailFin.position.set(-40, 7, 0);
  const hub = new THREE.Mesh(heliGeo.hub, MAT.heli.rotor);
  hub.position.set(0, 12, 0);
  const rotor = new THREE.Group();
  rotor.position.set(0, 12, 0);
  const bladeA = new THREE.Mesh(heliGeo.rotorBlade, MAT.heli.rotor);
  const bladeB = new THREE.Mesh(heliGeo.rotorBlade, MAT.heli.rotor);
  bladeB.rotation.y = Math.PI / 2;
  rotor.add(bladeA, bladeB);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-41, 3, 0);
  const tBladeA = new THREE.Mesh(heliGeo.tailRotorBlade, MAT.heli.rotor);
  const tBladeB = new THREE.Mesh(heliGeo.tailRotorBlade, MAT.heli.rotor);
  tBladeB.rotation.x = Math.PI / 2;
  tailRotor.add(tBladeA, tBladeB);
  const skidL = new THREE.Mesh(heliGeo.skid, MAT.heli.skid);
  skidL.rotation.z = Math.PI / 2; skidL.position.set(-2, -11, 7);
  const skidR = new THREE.Mesh(heliGeo.skid, MAT.heli.skid);
  skidR.rotation.z = Math.PI / 2; skidR.position.set(-2, -11, -7);
  const strutFL = new THREE.Mesh(heliGeo.strut, MAT.heli.skid);
  strutFL.position.set(6, -6, 7);
  const strutBL = new THREE.Mesh(heliGeo.strut, MAT.heli.skid);
  strutBL.position.set(-8, -6, 7);
  const strutFR = new THREE.Mesh(heliGeo.strut, MAT.heli.skid);
  strutFR.position.set(6, -6, -7);
  const strutBR = new THREE.Mesh(heliGeo.strut, MAT.heli.skid);
  strutBR.position.set(-8, -6, -7);
  root.add(body, cockpit, tailBoom, tailFin, hub, rotor, tailRotor, skidL, skidR, strutFL, strutBL, strutFR, strutBR);
  shadow(body, cockpit, tailBoom);
  return { root, body, rotor, tailRotor };
}
const heliPool = pool(makeHeli);

// ---------------------------------------------------------------------------
export function update(){
  const t = performance.now() / 1000;

  for (const en of state.enemies){
    const rec = goblinPool.get(en);
    const drawX = en.drawX !== undefined ? en.drawX : en.x;
    rec.root.position.copy(worldToScene(drawX, en.y));
    rec.root.rotation.z = Math.sin(t * 0.9 + (en.phase || 0)) * 0.18; // banqueo de vuelo
    rec.board.rotation.x = Math.sin(t * 1.3 + (en.phase || 0)) * 0.08;
    rec.armL.rotation.x = Math.sin(t * 2 + (en.phase || 0)) * 0.2;
    rec.armR.rotation.x = Math.sin(t * 2 + (en.phase || 0) + 1.4) * 0.2;
  }
  goblinPool.sweep(state.enemies);

  for (const c of state.climbers){
    const rec = climberPool.get(c);
    rec.root.position.copy(worldToScene(c.x, c.y));
    const phase = c.phase || 0;
    const wobTR = Math.sin(t * 4 + phase) * 0.5;
    const wobBR = Math.sin(t * 4 + phase + 1.6) * 0.5;
    const wobTL = Math.sin(t * 4 + phase + 3.1) * 0.5;
    const wobBL = Math.sin(t * 4 + phase + 4.7) * 0.5;
    rec.armTR.rotation.z = -0.5 + wobTR * 0.3; rec.armTR.rotation.x = wobTR * 0.4;
    rec.armBR.rotation.z = -0.9 + wobBR * 0.3; rec.armBR.rotation.x = wobBR * 0.4;
    rec.armTL.rotation.z = 0.5 - wobTL * 0.3; rec.armTL.rotation.x = wobTL * 0.4;
    rec.armBL.rotation.z = 0.9 - wobBL * 0.3; rec.armBL.rotation.x = wobBL * 0.4;
  }
  climberPool.sweep(state.climbers);

  for (const r of state.rhinos){
    const rec = rhinoPool.get(r);
    rec.root.position.copy(worldToScene(r.x, state.groundY - 20));
    const legPhase = Math.sin(t * 9 + r.x * 0.05) * 0.35;
    rec.legF.rotation.z = legPhase;
    rec.legB.rotation.z = -legPhase;
  }
  rhinoPool.sweep(state.rhinos);

  for (const s of state.sandHands){
    const rec = sandPool.get(s);
    const topY = s.topY !== undefined ? s.topY : state.groundY;
    rec.root.position.copy(worldToScene(s.x, (topY + state.groundY) / 2));
    const h = Math.max(1, state.groundY - topY);
    rec.root.scale.y = h / 60;
  }
  sandPool.sweep(state.sandHands);

  for (const s of state.scorpions){
    const rec = scorpionPool.get(s);
    rec.root.position.copy(worldToScene(s.x, s.y));
    const chargeUp = s.cooldown !== undefined && s.baseCooldown ? Math.max(0, 1 - s.cooldown / 30) : 0;
    rec.stinger.scale.setScalar(1 + chargeUp * 0.35);
    rec.tailPivot.rotation.z = Math.sin(t * 1.5 + s.x * 0.01) * 0.08;
  }
  scorpionPool.sweep(state.scorpions);

  for (const c of state.cranes){
    const rec = cranePool.get(c);
    // punto de contacto exacto: el jugador se engancha por raycast a hookX/hookY,
    // así que el root queda siempre en z=0 (regla dura para este objeto).
    rec.root.position.copy(worldToScene(c.hookX, c.hookY));
  }
  cranePool.sweep(state.cranes);

  for (const h of state.helicopters){
    const rec = heliPool.get(h);
    rec.root.position.copy(worldToScene(h.x, h.y));
    rec.root.rotation.z = h.state === 'leaving' ? -0.25 : 0;
    rec.rotor.rotation.y += 1.1; // giro rápido; visto de costado, foreshortening natural
    rec.tailRotor.rotation.x += 1.6;
    rec.body.material = h.state === 'riding' ? MAT.heli.bodyRiding : MAT.heli.body;
  }
  heliPool.sweep(state.helicopters);
}
