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
import { enemyGroup, worldToScene, qualityTier } from './world3d.js';
import * as state from './state.js';

const isLowTier = qualityTier === 'low';

// margen fuera de cámara donde igual se sigue animando (evita pop-in justo en
// el borde) — costo real de CPU: la mayoría de estos enemigos tienen animación
// trigonométrica por frame en varias piezas (brazos, cola, patas...); saltarla
// del todo para lo que ni se ve es la optimización de más impacto acá, sin
// tocar gameplay (el objeto sigue existiendo en `state.js`, solo no se dibuja).
const VISIBILITY_MARGIN = 200;
function isNearCamera(x){
  return x > state.cameraX - VISIBILITY_MARGIN && x < state.cameraX + state.W + VISIBILITY_MARGIN;
}

// Pase "realismo": material PBR real en vez de MeshToonMaterial+gradientMap.
// roughness/metalness reales por tipo de superficie -- ver comentarios en MAT.
function pbr(color, extra){ return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra }); }
function basic(color){ return new THREE.MeshBasicMaterial({ color }); }
function glowMat(color){
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
}

// ---------------------------------------------------------------------------
// Texturas procedurales (canvas, generadas una sola vez al cargar el módulo,
// nunca por frame) para dar textura de superficie real en vez de color liso:
// piel rugosa del rhino, arena granular, y la grieta de aviso del "sentido
// arácnido" (pedido 3).
// ---------------------------------------------------------------------------
function makeCanvasTexture(size, draw){
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  draw(cvs.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function grayNoiseTexture(size, contrast, base){
  base = base === undefined ? 128 : base;
  return makeCanvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4){
      const v = Math.min(255, Math.max(0, base + (Math.random() - 0.5) * 255 * contrast));
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}
function speckleTexture(size, base, speckle, count){
  return makeCanvasTexture(size, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < count; i++){
      ctx.fillStyle = speckle;
      ctx.globalAlpha = 0.3 + Math.random() * 0.45;
      const x = Math.random() * s, y = Math.random() * s, r = Math.random() * 1.6 + 0.3;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}
function crackTexture(size){
  return makeCanvasTexture(size, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    const cx = s / 2, cy = s / 2;
    const branches = 7;
    for (let b = 0; b < branches; b++){
      let ang = (b / branches) * Math.PI * 2 + Math.random() * 0.5;
      let x = cx, y = cy;
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(x, y);
      const steps = 5, len = s * 0.42;
      for (let i = 0; i < steps; i++){
        ang += (Math.random() - 0.5) * 0.9;
        x += Math.cos(ang) * len / steps;
        y += Math.sin(ang) * len / steps;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}
// deforma levemente los vértices de una geometría COMPARTIDA, una sola vez al
// cargar el módulo -> silueta orgánica/irregular sin costo por frame ni por
// instancia (todas las manos de arena comparten la misma geometría "esculpida").
function jitterGeometry(geo, amount){
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++){
    pos.setXYZ(i,
      pos.getX(i) + (Math.random() - 0.5) * amount,
      pos.getY(i) + (Math.random() - 0.5) * amount,
      pos.getZ(i) + (Math.random() - 0.5) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

// piel del rhino: bump (relieve) + roughness map (variación sutil de brillo)
// generados del mismo ruido en escala de grises, más detallados en tier alto.
const rhinoSkinBump = grayNoiseTexture(isLowTier ? 64 : 128, 0.9);
rhinoSkinBump.repeat.set(3, 3);
// base alta (215) y contraste bajo -> el roughness final se mantiene siempre
// alto (piel/cuero mate) con variación leve en vez de aplanar el material.
const rhinoSkinRough = grayNoiseTexture(isLowTier ? 64 : 128, 0.18, 215);
rhinoSkinRough.repeat.set(3, 3);
const sandGrainTex = speckleTexture(128, '#c9a56b', '#8a6a42', 900);
const sandGrainTexDark = speckleTexture(128, '#8a6a42', '#5f4526', 700);
const sandCrackTex = crackTexture(128);
// metal del climber: rayones/desgaste sutil sobre las juntas y pistones (las
// piezas "usadas"), no sobre torso/brazos principales que quedan pulidos.
// Se salta del todo en tier bajo (textura extra sólo si el hardware la banca).
const metalScratchRough = isLowTier ? null : grayNoiseTexture(96, 0.32, 195);
if (metalScratchRough) metalScratchRough.repeat.set(2, 2);

const MAT = {
  goblin: {
    // tabla: fibra/resina rígida -- ni mate de tela ni brillante de metal.
    board: pbr('#1a2b14', { roughness: 0.55, metalness: 0 }),
    // traje/piel del cuerpo: cuero sintético con algo de sheen.
    body: pbr('#357a2c', { roughness: 0.6, metalness: 0.05 }),
    hood: pbr('#16240f', { roughness: 0.7, metalness: 0 }),
    // capa: tela real -- muy rugosa, sin metal, para que no lea como plástico sólido.
    cloak: pbr('#16240f', { roughness: 0.95, metalness: 0 }),
    eye: basic('#ffe066'),
    glow: glowMat('#78ff5a'),
  },
  climber: {
    // torso/brazo superior: chasis principal pulido.
    torso: pbr('#3a3f47', { roughness: 0.35, metalness: 0.85 }),
    arm: pbr('#8b929c', { roughness: 0.4, metalness: 0.85 }),
    // juntas/pistones: piezas de uso -- más rugosas, con rayones sutiles.
    joint: pbr('#5b616a', { roughness: 0.6, metalness: 0.75, roughnessMap: metalScratchRough || null }),
    leg: pbr('#23262b', { roughness: 0.5, metalness: 0.8 }),
    lens: basic('#ff3b3b'),
    glow: glowMat('#ff3c3c'),
  },
  rhino: {
    // piel/cuero de animal real: sin metal, roughness alto, bump + roughness
    // map procedurales para que no quede liso tipo plástico.
    body: pbr('#7d7262', { roughness: 0.82, metalness: 0, bumpMap: rhinoSkinBump, bumpScale: 0.8, roughnessMap: rhinoSkinRough }),
    plate: pbr('#5c5346', { roughness: 0.88, metalness: 0, bumpMap: rhinoSkinBump, bumpScale: 0.8, roughnessMap: rhinoSkinRough }),
    // cuerno: queratina -- algo más lisa/pulida que la piel.
    horn: pbr('#d9cdb0', { roughness: 0.55, metalness: 0 }),
    eye: basic('#231810'),
  },
  sand: {
    // arena granular: no brilla nunca, roughness al máximo, sin metal.
    body: pbr('#e2c896', { roughness: 0.95, metalness: 0, map: sandGrainTex }),
    dark: pbr('#c9ac7c', { roughness: 0.95, metalness: 0, map: sandGrainTexDark }),
    warnGlow: new THREE.MeshBasicMaterial({ color: '#ffb347', map: sandCrackTex, transparent: true, opacity: 0, depthWrite: false }),
  },
  scorpion: {
    // exoesqueleto/quitina: brillo característico real -- roughness medio-bajo,
    // sin metal (no es metálico, es un brillo orgánico duro).
    body: pbr('#1c3324', { roughness: 0.4, metalness: 0 }),
    plate: pbr('#25422e', { roughness: 0.4, metalness: 0 }),
    tail: pbr('#274a34', { roughness: 0.45, metalness: 0 }),
    // membranas entre segmentos: más mate que el caparazón.
    joint: pbr('#1a2c1f', { roughness: 0.6, metalness: 0 }),
    pincer: pbr('#2c5238', { roughness: 0.35, metalness: 0 }),
    leg: pbr('#16281c', { roughness: 0.55, metalness: 0 }),
    stinger: basic('#8aff6a'),
    eye: basic('#ffe066'),
    // tier low: mismo costo de fill-rate que los glows de arriba (mesh
    // translúcido depthWrite:false superpuesto) — se mantiene visible pero
    // más tenue en vez de sacarlo del todo. Sigue simulando barato el brillo
    // quitinoso translúcido encima del MeshStandardMaterial del caparazón.
    shine: new THREE.MeshBasicMaterial({ color: '#eafff0', transparent: true, opacity: isLowTier ? 0.16 : 0.3, depthWrite: false }),
  },
  heli: {
    // carrocería: pintura automotriz -- roughness bajo-medio, algo de metalness.
    body: pbr('#2b3a4a', { roughness: 0.35, metalness: 0.55 }),
    bodyRiding: pbr('#c0272d', { roughness: 0.35, metalness: 0.55 }),
    // cabina: vidrio -- roughness muy bajo, algo de metalness, transparencia existente.
    cockpit: new THREE.MeshStandardMaterial({ color: '#b4dcff', roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.85 }),
    rotor: pbr('#cfd6dd', { roughness: 0.45, metalness: 0.75 }),
    // patines: metal sin pintar.
    skid: pbr('#1a1f26', { roughness: 0.5, metalness: 0.85 }),
  },
};

// onDispose (opcional): la gran mayoría de los pools de este archivo reusan
// geometría/material 100% COMPARTIDos entre instancias (constantes de módulo,
// nunca clonados) — para esos no hace falta disponer nada al sacar un objeto
// del pool. onDispose existe solo para el puñado de casos que sí crean un
// recurso ÚNICO por instancia (ver sandPool más abajo, warnMat).
function pool(makeFn, onDispose){
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
        if (!alive.has(obj)){
          enemyGroup.remove(rec.root);
          if (onDispose) onDispose(rec);
          byObj.delete(obj);
        }
      }
    }
  };
}

function shadow(...meshes){ for (const m of meshes) m.castShadow = true; }

// ---------------------------------------------------------------------------
// Villano volador ("goblin"): silueta propia — tabla voladora + figura
// encapuchada verde oscuro, ojos brillantes. Nada de máscara/traje calcado.
// Pase 2: "parentesco con la realidad" acá significa credibilidad física —
// una tabla con forma aerodinámica real (morro afinado + estabilizador de
// cola) en vez de una caja lisa, y una capa de tela que se lee con quiebres
// y aletea con el viento en vez de una silueta rígida de bloque.
// ---------------------------------------------------------------------------
const goblinGeo = {
  board: new THREE.BoxGeometry(28, 3, 11),
  boardNose: new THREE.ConeGeometry(5.5, 11, 4),
  boardFin: new THREE.BoxGeometry(2.2, 5, 1.4),
  body: new THREE.CapsuleGeometry(6, 9, 3, 6),
  hood: new THREE.ConeGeometry(7.2, 15, 6),
  shoulder: new THREE.BoxGeometry(4, 3, 5),
  cape: new THREE.BoxGeometry(0.8, 15, 11),
  arm: new THREE.CapsuleGeometry(2, 12, 2, 5),
  eye: new THREE.SphereGeometry(1.3, 6, 5),
  // tier low: el glow es un círculo grande con alpha blending (depthWrite
  // false) superpuesto a cada goblin en pantalla — puro costo de fill-rate,
  // no de geometría. Achicar el radio recorta cuántos píxeles se blendean.
  glow: new THREE.CircleGeometry(isLowTier ? 18 : 28, isLowTier ? 10 : 16),
};
function makeGoblin(){
  const root = new THREE.Group();
  const glow = new THREE.Mesh(goblinGeo.glow, MAT.goblin.glow);
  glow.position.z = -10;
  const board = new THREE.Mesh(goblinGeo.board, MAT.goblin.board);
  board.position.set(0, -11, 0);
  const boardNose = new THREE.Mesh(goblinGeo.boardNose, MAT.goblin.board);
  boardNose.position.set(15.5, -11, 0);
  boardNose.rotation.z = -Math.PI / 2; boardNose.scale.set(1, 1, 0.55);
  const boardFin = new THREE.Mesh(goblinGeo.boardFin, MAT.goblin.hood);
  boardFin.position.set(-13, -8.5, 0);
  const body = new THREE.Mesh(goblinGeo.body, MAT.goblin.body);
  body.position.set(0, -1, 0);
  const hood = new THREE.Mesh(goblinGeo.hood, MAT.goblin.hood);
  hood.position.set(0, 10, 0);
  const shoulderR = new THREE.Mesh(goblinGeo.shoulder, MAT.goblin.hood);
  shoulderR.position.set(6, 4, 0); shoulderR.rotation.y = 0.3;
  const shoulderL = new THREE.Mesh(goblinGeo.shoulder, MAT.goblin.hood);
  shoulderL.position.set(-6, 5, 0); shoulderL.rotation.y = -0.3;
  const cape = new THREE.Mesh(goblinGeo.cape, MAT.goblin.cloak);
  cape.position.set(-4.5, 2, 0);
  const armR = new THREE.Mesh(goblinGeo.arm, MAT.goblin.body);
  armR.position.set(9, 2, 0); armR.rotation.z = -0.65;
  const armL = new THREE.Mesh(goblinGeo.arm, MAT.goblin.body);
  armL.position.set(-9, 4, 0); armL.rotation.z = 0.5;
  const eyeR = new THREE.Mesh(goblinGeo.eye, MAT.goblin.eye);
  eyeR.position.set(2.4, 11, 6);
  const eyeL = new THREE.Mesh(goblinGeo.eye, MAT.goblin.eye);
  eyeL.position.set(-2.4, 11, 6);
  root.add(glow, board, boardNose, boardFin, body, hood, shoulderR, shoulderL, cape, armR, armL, eyeR, eyeL);
  shadow(board, boardNose, body, hood, cape, armR, armL);
  return { root, board, body, hood, cape, armR, armL };
}
const goblinPool = pool(makeGoblin);

// ---------------------------------------------------------------------------
// Trepador mecánico: exo-traje con 4 brazos mecánicos desde los hombros (ya
// decidido en el proyecto para que no se lea como araña), lente rojo único.
// Pase 2: "parentesco con la realidad" acá es credibilidad MECÁNICA — cada
// brazo pasa a ser un par hombro/codo articulado (bola de rótula + antebrazo
// con ángulo fijo de codo) con un pequeño pistón hidráulico pegado al brazo
// superior, en vez de una única cápsula lisa flotando.
// ---------------------------------------------------------------------------
const climberGeo = {
  torso: new THREE.CapsuleGeometry(9, 13, 3, 6),
  head: new THREE.SphereGeometry(7, 10, 8),
  lens: new THREE.SphereGeometry(2.4, 8, 6),
  joint: new THREE.SphereGeometry(2.3, 7, 6),
  armUpper: new THREE.CapsuleGeometry(2.1, 6, 2, 5),
  armLower: new THREE.CapsuleGeometry(1.7, 6.5, 2, 5),
  piston: new THREE.CylinderGeometry(0.7, 0.7, 6.5, 5),
  leg: new THREE.CapsuleGeometry(2.5, 7, 2, 5),
  // tier low: mismo motivo que el glow del goblin — recorta fill-rate del
  // círculo translúcido, no geometría de mesh sólido.
  glow: new THREE.CircleGeometry(isLowTier ? 19 : 30, isLowTier ? 10 : 16),
};
function makeArm(){
  // hombro (rótula) -> brazo superior + pistón -> codo (rótula) -> antebrazo,
  // con una flexión de codo fija: el pivot completo se balancea en update()
  // igual que antes (rotation.z/x), así el "wobble" de caminata se mantiene.
  const pivot = new THREE.Group();
  const shoulder = new THREE.Mesh(climberGeo.joint, MAT.climber.joint);
  const upper = new THREE.Mesh(climberGeo.armUpper, MAT.climber.arm);
  upper.position.y = -4.5;
  const piston = new THREE.Mesh(climberGeo.piston, MAT.climber.joint);
  piston.position.set(1.8, -4.5, 0.8); piston.scale.set(1, 0.9, 1);
  const elbow = new THREE.Mesh(climberGeo.joint, MAT.climber.joint);
  elbow.position.y = -8.5;
  const forearmPivot = new THREE.Group();
  forearmPivot.position.y = -8.5;
  forearmPivot.rotation.z = 0.32; // ángulo de codo fijo -> lee como brazo doblado, no un palo recto
  const forearm = new THREE.Mesh(climberGeo.armLower, MAT.climber.arm);
  forearm.position.y = -3.6;
  forearmPivot.add(forearm);
  pivot.add(shoulder, upper, piston, elbow, forearmPivot);
  shadow(upper, forearm, piston);
  return pivot;
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
  // para dar volumen (el helicóptero es el único que debe quedar exactamente
  // en z=0, por su rol de vehículo genérico sin restricción de silueta).
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
// Rhino: pase 2 acerca la silueta a la anatomía real de un rinoceronte de
// verdad (NO al traje del personaje de cómic) — cuerpo macizo y rechoncho
// sobre 4 patas cortas y gruesas, orejas chicas redondeadas, piel rugosa
// (bump map procedural, ver arriba) y un cuerno frontal curvo de base
// gruesa (cadena de 2 piezas, mismo criterio FK que la cola del escorpión)
// con un segundo cuerno más chico detrás, como en un rinoceronte de dos
// cuernos. Paleta propia gris-parda mate, nada de gris metálico de traje.
// ---------------------------------------------------------------------------
const rhinoGeo = {
  body: jitterGeometry(new THREE.CapsuleGeometry(16, 20, 4, 8), 0.7),
  hump: jitterGeometry(new THREE.SphereGeometry(14, 8, 6), 0.6),
  head: jitterGeometry(new THREE.SphereGeometry(11, 10, 8), 0.5),
  ear: new THREE.ConeGeometry(3.4, 5, 6),
  hornBase: new THREE.CylinderGeometry(5.4, 7.2, 11, 7),
  hornTip: new THREE.ConeGeometry(3.6, 10, 7),
  horn2: new THREE.ConeGeometry(2.6, 6.5, 6),
  leg: new THREE.CylinderGeometry(5.6, 6.8, 13, 7),
  eye: new THREE.SphereGeometry(1.8, 6, 5),
};
function makeRhino(){
  const root = new THREE.Group();
  const body = new THREE.Mesh(rhinoGeo.body, MAT.rhino.body);
  body.rotation.z = Math.PI / 2; // capsula acostada = torso macizo y rechoncho
  body.position.set(-2, 2, 0);
  const hump = new THREE.Mesh(rhinoGeo.hump, MAT.rhino.plate);
  hump.position.set(-7, 12, 0); hump.scale.set(1.3, 0.8, 1.05); // giba/lomo muscular, no placa de armadura
  const head = new THREE.Mesh(rhinoGeo.head, MAT.rhino.body);
  head.position.set(19, 1, 0);
  const earR = new THREE.Mesh(rhinoGeo.ear, MAT.rhino.plate);
  earR.position.set(13, 10, 6); earR.rotation.set(-0.5, 0, -0.3); earR.scale.set(1, 1, 0.55);
  const earL = new THREE.Mesh(rhinoGeo.ear, MAT.rhino.plate);
  earL.position.set(13, 10, -6); earL.rotation.set(0.5, 0, -0.3); earL.scale.set(1, 1, 0.55);
  // cuerno principal: base gruesa fija + punta más fina en un pivot propio ->
  // pequeña curva hacia atrás en vez de un cono liso perfectamente recto.
  const hornBase = new THREE.Mesh(rhinoGeo.hornBase, MAT.rhino.horn);
  hornBase.position.set(27.5, 2, 0);
  hornBase.rotation.z = -Math.PI / 2 + 0.3;
  const hornTip = new THREE.Mesh(rhinoGeo.hornTip, MAT.rhino.horn);
  hornTip.position.set(33.5, 8, 0);
  hornTip.rotation.z = -Math.PI / 2 + 0.6; // se curva un poco más hacia atrás en la punta
  const horn2 = new THREE.Mesh(rhinoGeo.horn2, MAT.rhino.horn);
  horn2.position.set(21.5, 6.5, 0);
  horn2.rotation.z = -Math.PI / 2 + 0.15; // segundo cuerno, más chico, detrás del principal
  const eye = new THREE.Mesh(rhinoGeo.eye, MAT.rhino.eye);
  eye.position.set(23, 3, 8.5);
  const legFR = new THREE.Mesh(rhinoGeo.leg, MAT.rhino.plate);
  legFR.position.set(11, -14, 8);
  const legFL = new THREE.Mesh(rhinoGeo.leg, MAT.rhino.plate);
  legFL.position.set(11, -14, -8);
  const legBR = new THREE.Mesh(rhinoGeo.leg, MAT.rhino.plate);
  legBR.position.set(-15, -14, 8);
  const legBL = new THREE.Mesh(rhinoGeo.leg, MAT.rhino.plate);
  legBL.position.set(-15, -14, -8);
  root.add(body, hump, head, earR, earL, hornBase, hornTip, horn2, eye, legFR, legFL, legBR, legBL);
  shadow(body, hump, head, legFR, legFL, legBR, legBL);
  return { root, legFR, legFL, legBR, legBL };
}
const rhinoPool = pool(makeRhino);

// ---------------------------------------------------------------------------
// Mano de arena: pase 2 la acerca a arena/tierra de verdad en vez de un brazo
// de dedos geométricos perfectos — superficie granular (textura de color con
// ruido, ver arriba), silueta orgánica (geometría "esculpida" con jitter en
// vez de esferas/cilindros perfectos) y motas de arena que se desprenden y
// caen constantemente por los costados mientras la mano está afuera.
//
// Pedido 3 (aviso "sentido arácnido"): la mano ya no sube por cercanía sino
// por un ciclo propio (state.js), con una fase de aviso previa expuesta en
// `s.warning` (0->1, ~45 frames antes de que empiece a subir). Acá se lee
// ese campo para dibujar, ANTES de que la mano sea visible, una grieta que
// pulsa en el piso + polvo que tiembla en `s.x` — la señal de "algo va a
// pasar acá" que le da al jugador tiempo real para esquivar.
//
// Estructura del rig: `root` queda SIEMPRE fijo a nivel de piso (nunca se
// mueve ni se escala) para que `warnGroup` pueda vivir ahí sin heredar el
// achatado de la mano; `handGroup` (hijo) es el que se traslada/escala
// verticalmente con la fórmula de siempre (geometría local y=-30..+30).
// ---------------------------------------------------------------------------
const sandGeo = {
  forearm: jitterGeometry(new THREE.CylinderGeometry(9, 13, 32, 7), 1.1),
  palm: jitterGeometry(new THREE.SphereGeometry(13, 8, 6), 1.3),
  finger: jitterGeometry(new THREE.CylinderGeometry(1.6, 4.2, 22, 5), 0.7),
  grain: new THREE.IcosahedronGeometry(2.4, 0),
  mote: new THREE.IcosahedronGeometry(1.1, 0),
  crack: new THREE.CircleGeometry(24, 16),
  dust: new THREE.IcosahedronGeometry(1.4, 0),
};
const FINGER_LAYOUT = [
  { x: -18, len: 22, tilt: -0.3,  twist: 0.4 },
  { x: -6,  len: 28, tilt: -0.08, twist: -0.3 },
  { x: 6,   len: 28, tilt: 0.09,  twist: 0.25 },
  { x: 17,  len: 21, tilt: 0.32,  twist: -0.35 },
];
function makeSandHand(){
  const root = new THREE.Group();

  const handGroup = new THREE.Group();
  const forearm = new THREE.Mesh(sandGeo.forearm, MAT.sand.dark);
  forearm.position.set(0, -14, 0);
  const palm = new THREE.Mesh(sandGeo.palm, MAT.sand.body);
  palm.position.set(0, 4, 0); palm.scale.set(1, 0.85, 0.75);
  handGroup.add(forearm, palm);
  const fingers = FINGER_LAYOUT.map(f => {
    const finger = new THREE.Mesh(sandGeo.finger, MAT.sand.body);
    finger.position.set(f.x, 4 + f.len / 2, 0);
    finger.rotation.z = f.tilt;
    finger.rotation.y = f.twist; // rompe la simetría perfecta -> lee más orgánico
    handGroup.add(finger);
    return finger;
  });
  // grumos de arena para lectura "granular" adicional a la textura de color
  const grains = [];
  const grainSpots = [[-9, -6, 8], [7, -10, -7], [0, 8, 9], [-12, 10, -6], [10, 6, 7], [-4, -18, 6], [3, -20, -8]];
  for (const [gx, gy, gz] of grainSpots){
    const g = new THREE.Mesh(sandGeo.grain, MAT.sand.dark);
    g.position.set(gx, gy, gz);
    g.scale.setScalar(0.7 + Math.random() * 0.6);
    handGroup.add(g);
    grains.push(g);
  }
  shadow(forearm, palm, ...fingers);
  root.add(handGroup);

  // motas de arena desprendiéndose por los bordes y cayendo sin parar
  // mientras la mano está afuera (unas pocas mallas reposicionadas en
  // update(), sin sistema de partículas ni geometría nueva por frame).
  const fallers = [];
  // tier low: menos motas cayendo por mano de arena activa — cada una es un
  // mesh sólido aparte (no instanced) que se reposiciona por frame, así que
  // menos unidades == menos draw calls mientras la mano está afuera.
  const FALLER_COUNT = isLowTier ? 4 : 7;
  for (let i = 0; i < FALLER_COUNT; i++){
    const mote = new THREE.Mesh(sandGeo.mote, i % 2 ? MAT.sand.dark : MAT.sand.body);
    mote.visible = false;
    root.add(mote);
    fallers.push({ mesh: mote, seed: Math.random() * 10, xOff: (Math.random() - 0.5) * 34, zOff: (Math.random() - 0.5) * 14, speed: 0.5 + Math.random() * 0.4 });
  }

  // aviso "sentido arácnido" (pedido 3): grieta que pulsa + polvo que
  // tiembla, a nivel de piso, independiente del escalado de la mano.
  const warnGroup = new THREE.Group();
  const warnMat = MAT.sand.warnGlow.clone(); // opacidad por-instancia (cada mano avisa distinto)
  const crack = new THREE.Mesh(sandGeo.crack, warnMat);
  crack.rotation.z = Math.random() * Math.PI;
  warnGroup.add(crack);
  const dust = [];
  const dustSpots = [[-12, 3], [10, -4], [-3, 7], [4, -6]];
  for (const [dx, dz] of dustSpots){
    const d = new THREE.Mesh(sandGeo.dust, MAT.sand.dark);
    d.position.set(dx, 0, dz);
    d.scale.setScalar(0.6);
    warnGroup.add(d);
    dust.push({ mesh: d, seed: Math.random() * 10 });
  }
  root.add(warnGroup);

  return { root, handGroup, fallers, warnGroup, warnMat, crack, dust };
}
// warnMat es un .clone() ÚNICO por mano de arena (ver makeSandHand: "opacidad
// por-instancia") — a diferencia de toda otra geometría/material de este
// archivo, ese clon no es compartido con ninguna otra instancia y por lo tanto
// SÍ hay que disponerlo al sacar la mano del pool, o queda filtrando un
// material nuevo por cada mano de arena que pasó por pantalla en la partida.
const sandPool = pool(makeSandHand, rec => rec.warnMat.dispose());

// ---------------------------------------------------------------------------
// Escorpión: pase 2 acerca la anatomía a un escorpión de verdad — cuerpo
// segmentado con placas superpuestas (no una esfera lisa), DOS pinzas
// (pedipalpos) delanteras bien definidas, 8 patitas esquemáticas a los
// costados, y una cola de segmentos claramente separados (esferas de
// articulación entre cápsula y cápsula) que termina en un aguijón curvo de
// dos piezas. El "brillo especular quitinoso" se simula barato con una
// pequeña malla translúcida superpuesta (mismo truco que el glow del
// goblin/climber) en vez de cambiar de material.
// ---------------------------------------------------------------------------
const scorpionGeo = {
  body: new THREE.SphereGeometry(11, 10, 8),
  plateMid: new THREE.SphereGeometry(8, 8, 6),
  plateBack: new THREE.SphereGeometry(6, 8, 6),
  seg: new THREE.CapsuleGeometry(2.6, 7, 2, 5),
  tailJoint: new THREE.SphereGeometry(2.9, 6, 5),
  stingerBase: new THREE.ConeGeometry(3, 5, 6),
  stingerTip: new THREE.ConeGeometry(1.7, 5, 6),
  eye: new THREE.SphereGeometry(1.4, 6, 5),
  pincerArm: new THREE.CapsuleGeometry(2.3, 7, 2, 5),
  pincerClaw: new THREE.ConeGeometry(2.4, 5.5, 5),
  leg: new THREE.CapsuleGeometry(1, 6.5, 2, 4),
  shine: new THREE.SphereGeometry(5, 8, 6),
};
function makePincer(mirror){
  const root = new THREE.Group();
  const arm = new THREE.Mesh(scorpionGeo.pincerArm, MAT.scorpion.pincer);
  arm.position.y = 3.5;
  const claw = new THREE.Mesh(scorpionGeo.pincerClaw, MAT.scorpion.pincer);
  claw.position.y = 7.5; claw.rotation.x = mirror ? 0.5 : -0.5;
  root.add(arm, claw);
  root.rotation.z = mirror ? -1.15 : 1.15;
  root.rotation.y = mirror ? -0.35 : 0.35;
  shadow(arm, claw);
  return root;
}
function makeLeg(side, i){
  const leg = new THREE.Mesh(scorpionGeo.leg, MAT.scorpion.leg);
  leg.rotation.z = side * 1.1;
  leg.rotation.x = (i - 1.5) * 0.05;
  leg.castShadow = true;
  return leg;
}
function makeScorpion(){
  const root = new THREE.Group();
  const body = new THREE.Mesh(scorpionGeo.body, MAT.scorpion.body);
  body.scale.set(1, 0.75, 0.9);
  // placas del abdomen superpuestas, decreciendo hacia la cola -> cuerpo
  // segmentado en vez de una sola esfera lisa.
  const plateMid = new THREE.Mesh(scorpionGeo.plateMid, MAT.scorpion.plate);
  plateMid.position.set(-9, 1, 0); plateMid.scale.set(1, 0.7, 0.85);
  const plateBack = new THREE.Mesh(scorpionGeo.plateBack, MAT.scorpion.plate);
  plateBack.position.set(-15.5, 0.5, 0); plateBack.scale.set(1, 0.65, 0.8);
  const shine = new THREE.Mesh(scorpionGeo.shine, MAT.scorpion.shine);
  shine.position.set(2, 6, 3); shine.scale.set(0.9, 0.5, 0.6);
  const eyeR = new THREE.Mesh(scorpionGeo.eye, MAT.scorpion.eye);
  eyeR.position.set(-3, 2, 9);
  const eyeL = new THREE.Mesh(scorpionGeo.eye, MAT.scorpion.eye);
  eyeL.position.set(3, 2, 9);
  // pinzas (pedipalpos): dos brazos delanteros con garra, bien separados del
  // cuerpo de las 8 patas de caminar.
  const pincerR = makePincer(false); pincerR.position.set(9, 2, 6);
  const pincerL = makePincer(true); pincerL.position.set(9, 2, -6);
  // 8 patas esquemáticas, 4 por costado, a lo largo del cuerpo.
  const legs = [];
  const legXs = [-10, -3, 4, 10];
  for (let i = 0; i < legXs.length; i++){
    const legR = makeLeg(1, i); legR.position.set(legXs[i], -2, 7);
    const legL = makeLeg(-1, i); legL.position.set(legXs[i], -2, -7);
    root.add(legR, legL);
    legs.push(legR, legL);
  }
  // cola: cadena de 3 segmentos con esferas de articulación bien marcadas
  // entre cápsula y cápsula, arqueada sobre el "hombro" (FK simple, sin
  // animar hueso a hueso cada frame), terminando en un aguijón de 2 piezas
  // con leve quiebre -> lee curvo, no un cono recto.
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-2, 4, -2);
  let cursor = tailPivot;
  const segs = [];
  const joints = [];
  const segAngles = [-0.9, -1.3, -1.5];
  const segLens = [9, 8, 7];
  for (let i = 0; i < 3; i++){
    const pivot = new THREE.Group();
    pivot.rotation.z = segAngles[i];
    cursor.add(pivot);
    const joint = new THREE.Mesh(scorpionGeo.tailJoint, MAT.scorpion.joint);
    pivot.add(joint);
    joints.push(joint);
    const seg = new THREE.Mesh(scorpionGeo.seg, MAT.scorpion.tail);
    seg.position.y = segLens[i] / 2 + 1;
    pivot.add(seg);
    segs.push(seg);
    const next = new THREE.Group();
    next.position.y = segLens[i] + 1;
    pivot.add(next);
    cursor = next;
  }
  const stingerBase = new THREE.Mesh(scorpionGeo.stingerBase, MAT.scorpion.stinger);
  stingerBase.position.y = 2.5;
  const stingerTip = new THREE.Mesh(scorpionGeo.stingerTip, MAT.scorpion.stinger);
  stingerTip.position.y = 6.5; stingerTip.rotation.z = -0.5; // quiebre -> aguijón curvo, no recto
  cursor.add(stingerBase, stingerTip);
  root.add(body, plateMid, plateBack, shine, eyeR, eyeL, pincerR, pincerL, tailPivot);
  shadow(body, plateMid, plateBack, ...segs);
  return { root, body, tailPivot, stinger: stingerBase };
}
const scorpionPool = pool(makeScorpion);

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
    rec.root.visible = isNearCamera(drawX);
    if (!rec.root.visible) continue;
    rec.root.position.copy(worldToScene(drawX, en.y));
    rec.root.rotation.z = Math.sin(t * 0.9 + (en.phase || 0)) * 0.18; // banqueo de vuelo
    rec.board.rotation.x = Math.sin(t * 1.3 + (en.phase || 0)) * 0.08;
    rec.armL.rotation.x = Math.sin(t * 2 + (en.phase || 0)) * 0.2;
    rec.armR.rotation.x = Math.sin(t * 2 + (en.phase || 0) + 1.4) * 0.2;
    rec.cape.rotation.x = Math.sin(t * 2.4 + (en.phase || 0)) * 0.25 + 0.15; // aletea con el viento
    rec.cape.rotation.z = Math.sin(t * 1.7 + (en.phase || 0) + 0.8) * 0.12;
  }
  goblinPool.sweep(state.enemies);

  for (const c of state.climbers){
    const rec = climberPool.get(c);
    rec.root.visible = isNearCamera(c.x);
    if (!rec.root.visible) continue;
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
    rec.root.visible = isNearCamera(r.x);
    if (!rec.root.visible) continue;
    rec.root.position.copy(worldToScene(r.x, state.groundY - 20));
    // trote diagonal: FR+BL en fase, FL+BR en contrafase (marcha real de
    // cuadrúpedo en vez de las 2 patas "en espejo" de la Fase 1).
    const legPhase = Math.sin(t * 9 + r.x * 0.05) * 0.3;
    rec.legFR.rotation.z = legPhase;
    rec.legBL.rotation.z = legPhase;
    rec.legFL.rotation.z = -legPhase;
    rec.legBR.rotation.z = -legPhase;
  }
  rhinoPool.sweep(state.rhinos);

  for (const s of state.sandHands){
    const rec = sandPool.get(s);
    rec.root.visible = isNearCamera(s.x);
    if (!rec.root.visible) continue;
    // `root` queda fijo a nivel de piso; sólo `handGroup` se traslada/escala
    // según cuánto emergió la mano (misma fórmula que la Fase 1, aplicada al
    // hijo en vez de al root -> ver comentario arriba de makeSandHand).
    rec.root.position.copy(worldToScene(s.x, state.groundY));
    const topY = s.topY !== undefined ? s.topY : state.groundY;
    const h = Math.max(1, state.groundY - topY);
    rec.handGroup.position.y = h / 2;
    rec.handGroup.scale.y = h / 60;

    // motas de arena cayendo por los costados mientras la mano está afuera
    const risen = h > 4;
    for (const f of rec.fallers){
      f.mesh.visible = risen;
      if (risen){
        const frac = (t * f.speed + f.seed) % 1;
        f.mesh.position.set(f.xOff * (0.4 + frac * 0.6), h * (1 - frac), f.zOff);
        f.mesh.scale.setScalar(0.5 + (1 - frac) * 0.5);
      }
    }

    // pedido 3 — "sentido arácnido": grieta que pulsa + polvo que tiembla en
    // el piso ANTES de que la mano suba, leyendo `s.warning` (0->1) que ahora
    // arma el ciclo propio en state.js en vez de la cercanía del jugador.
    const warning = s.warning || 0;
    rec.warnGroup.visible = warning > 0.01;
    const pulse = 0.4 + 0.6 * (Math.sin(t * 8 + s.x * 0.02) * 0.5 + 0.5);
    rec.warnMat.opacity = warning * pulse;
    rec.crack.scale.setScalar(0.7 + warning * 0.6);
    for (const d of rec.dust){
      d.mesh.visible = warning > 0.05;
      d.mesh.position.y = Math.sin(t * 26 + d.seed) * 2.2 * warning;
    }
  }
  sandPool.sweep(state.sandHands);

  for (const s of state.scorpions){
    const rec = scorpionPool.get(s);
    rec.root.visible = isNearCamera(s.x);
    if (!rec.root.visible) continue;
    rec.root.position.copy(worldToScene(s.x, s.y));
    const chargeUp = s.cooldown !== undefined && s.baseCooldown ? Math.max(0, 1 - s.cooldown / 30) : 0;
    rec.stinger.scale.setScalar(1 + chargeUp * 0.35);
    rec.tailPivot.rotation.z = Math.sin(t * 1.5 + s.x * 0.01) * 0.08;
  }
  scorpionPool.sweep(state.scorpions);

  for (const h of state.helicopters){
    const rec = heliPool.get(h);
    rec.root.visible = isNearCamera(h.x);
    if (!rec.root.visible) continue;
    rec.root.position.copy(worldToScene(h.x, h.y));
    rec.root.rotation.z = h.state === 'leaving' ? -0.25 : 0;
    rec.rotor.rotation.y += 1.1; // giro rápido; visto de costado, foreshortening natural
    rec.tailRotor.rotation.x += 1.6;
    rec.body.material = h.state === 'riding' ? MAT.heli.bodyRiding : MAT.heli.body;
  }
  heliPool.sweep(state.helicopters);
}
