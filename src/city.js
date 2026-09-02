// ============================================================================
// Ciudad: cielo (domo con gradiente + sol/luna + estrellas + skyline lejano en
// paralaje), edificios (con landmarks propios: Empire escalonado, aguja de
// vidrio del WTC, neón de Times Square) y piso con carriles marcados.
// Fase 2 (pase de arte). Lee skystate.js, nunca la redefine.
//
// REGLA DURA: el frente de cada edificio (con el que interactúa la física) debe
// quedar exactamente en sceneZ = 0. Todo lo decorativo (domo, skyline lejano,
// sol/luna, molduras) puede vivir en cualquier Z.
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { cityGroup, scene, worldToScene, camera, FOV_Y_RAD, camDistanceForHeight, qualityTier, renderer } from './world3d.js';
import { getSkyState, lerpHexToHexString } from './skystate.js';
import * as state from './state.js';

const BUILDING_DEPTH = 60;
const isLowTier = qualityTier === 'low';

// tier low: la grilla de ventanas se recalcula en canvas-2d cada vez que un
// edificio nuevo entra en cámara (streaming horizontal) — menos celdas y una
// textura más chica bajan tanto el costo de ese loop en el hilo principal
// como el tamaño de la textura que sube a GPU por edificio.
const TEX_SIZE = isLowTier ? 96 : 128;
const TEX_COLS = isLowTier ? 8 : 12;
const TEX_ROWS = isLowTier ? 8 : 12;

// LCG simple y determinístico — mismo criterio que la versión 2D original
// (semilla derivada de Math.floor(b.x)) para que el neón de Times Square no
// "parpadee" a un layout nuevo en cada frame.
function makeRng(seed){
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
}

// ---------------------------------------------------------------------------
// textura de ventanas (fachada genérica + Empire + skyline lejano): mosaico
// de departamentos con ventanas prendidas/apagadas + variación de tono, en vez
// de un patrón fijo repetido — semilla estable por edificio (mismo criterio
// que el neón de Times Square, ver makeRng) para que no cambie de un frame a
// otro. En un subconjunto de las ventanas prendidas se agrega una silueta
// oscura simple (persona/mueble visto desde afuera) directo en el canvas: a
// la distancia de juego un blob simple alcanza, y sale gratis en términos de
// geometría/draw calls (nada de instancing necesario para esto).
// ---------------------------------------------------------------------------
function makeCanvasTex(canvas){
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // sin esto, la grilla de ventanas (chica, alto contraste, repetida varias
  // veces por edificio) hace muaré/entramado diagonal apenas se la ve a
  // distancia o de costado — es el sampleo por mip normal de Three.js sin
  // filtrado anisotrópico, no un bug del dibujo en sí. maxAnisotropy en un
  // edificio angosto de perfil no cuesta nada (misma textura de siempre,
  // solo mejor filtrada) y es la corrección estándar para este artefacto.
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// devuelve DOS texturas alineadas (mismo seed, misma grilla, mismas celdas
// salteadas) para la misma fachada:
//  - mapTex:  el "hueco de ventana" en sí — SIEMPRE visible (de día, de noche,
//    prendida o apagada), oscurecido levemente contra la pared. Sin esto la
//    fachada es un rectángulo de color liso sin ninguna abertura marcada
//    (el reclamo de "sin ventanas": antes la única pista de que había
//    ventanas era el brillo de las prendidas, que de día casi no se nota).
//  - emTex: el brillo cálido de las ventanas "prendidas" de noche —
//    exactamente lo que antes hacía windowTexture() sola, ahora separado.
// Comparten un único recorrido de rng() para que ambas grillas queden
// perfectamente alineadas (el brillo aparece justo sobre el hueco correcto).
function makeFacadeTextures(seed, bgColor){
  const SIZE = TEX_SIZE;
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = SIZE; mapCanvas.height = SIZE;
  const mapCtx = mapCanvas.getContext('2d');
  mapCtx.fillStyle = '#ffffff'; // blanco: no altera el color de la pared (map * color = color)
  mapCtx.fillRect(0, 0, SIZE, SIZE);

  const emCanvas = document.createElement('canvas');
  emCanvas.width = SIZE; emCanvas.height = SIZE;
  const emCtx = emCanvas.getContext('2d');
  emCtx.fillStyle = bgColor || '#0e0a16';
  emCtx.fillRect(0, 0, SIZE, SIZE);

  // look "silueta plana" (referencia: primera versión 2D) — grilla prolija de
  // cuadraditos, la gran mayoría prendidos, directo sobre la fachada (sin
  // marco/pilastra ni siluetas de gente: eso era detalle "realista sutil" de
  // una ronda anterior, acá se busca lo opuesto — lo más simple posible).
  const rng = makeRng(seed);
  const cols = TEX_COLS, rows = TEX_ROWS;
  const cw = SIZE / cols, ch = SIZE / rows;
  for (let r = 0; r < rows; r++){
    for (let col = 0; col < cols; col++){
      if ((r + col) % 3 === 0) continue; // hueco estructural entre ventanas
      const isLit = rng() > 0.15;
      const wx = col * cw + cw * 0.22, wy = r * ch + ch * 0.22;
      const ww = cw * 0.56, wh = ch * 0.56;
      const radius = Math.min(ww, wh) * 0.18;
      const frameM = Math.min(ww, wh) * 0.16;

      // marco (sill) más CLARO alrededor + vidrio más OSCURO adentro — el
      // contraste en las dos direcciones es lo que hace que el hueco de
      // ventana se lea con claridad contra la pared, no un solo tono apenas
      // distinto (eso era casi invisible: la queja original de "sin
      // ventanas" era justamente que de día no se notaban).
      mapCtx.fillStyle = 'rgba(255,255,255,0.22)';
      mapCtx.beginPath();
      if (mapCtx.roundRect) mapCtx.roundRect(wx - frameM, wy - frameM, ww + frameM * 2, wh + frameM * 2, radius + frameM);
      else mapCtx.rect(wx - frameM, wy - frameM, ww + frameM * 2, wh + frameM * 2);
      mapCtx.fill();
      mapCtx.fillStyle = 'rgba(0,0,0,0.55)';
      mapCtx.beginPath();
      if (mapCtx.roundRect) mapCtx.roundRect(wx, wy, ww, wh, radius);
      else mapCtx.rect(wx, wy, ww, wh);
      mapCtx.fill();

      emCtx.fillStyle = isLit
        ? 'rgba(255,214,130,0.95)' // "prendida" — mismo tono exacto que la versión 2D original
        : 'rgba(45,55,95,0.7)';    // "apagada": chata, sin reflejo ni variación de brillo
      emCtx.beginPath();
      if (emCtx.roundRect) emCtx.roundRect(wx, wy, ww, wh, radius);
      else emCtx.rect(wx, wy, ww, wh);
      emCtx.fill();
    }
  }
  return { mapTex: makeCanvasTex(mapCanvas), emTex: makeCanvasTex(emCanvas) };
}

// mismos dos patrones planos (blanco/negro, CC0, "Pattern Pack" de Kenney.nl:
// https://kenney.nl/assets/pattern-pack) que ya usamos para autos/gente —
// acá van como `map` (diffuse) de la fachada en vez de un color sólido. Son
// máscaras blanco/negro puras: MeshStandardMaterial multiplica `map` por
// `color`, así que el ladrillo/bloque queda teñido con el color de
// WALL_STYLES de siempre (blanco del PNG -> color de la pared, negro de la
// junta -> negro), sin tener que hornear un color por textura. No reemplaza
// la iluminación dinámica de ventanas (esa sigue siendo el emissiveMap de
// windowTexture() de siempre) — son dos texturas independientes en el mismo
// material.
const textureLoader = new THREE.TextureLoader();
function loadPatternTex(name){
  const tex = textureLoader.load(`/vendor/kenney/patterns/${name}.png`);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const brickPatternTex = loadPatternTex('brick'); // hiladas de ladrillo prolijas
const blockPatternTex = loadPatternTex('block'); // bloques más grandes, lee como piedra/panel

// paleta "silueta plana" — vuelta al look de la primera versión 2D del juego
// (referencia: skyline chato color sólido + grilla de ventanas prendidas,
// atardecer violeta->naranja, sin contorno tipo cómic ni mampostería
// texturada). Reemplaza la ronda "Jetpack Joyride" (colores de juguete +
// ladrillo/bloque de Kenney + contorno) — ese trabajo queda intacto en el
// código (brickPatternTex/blockPatternTex, pattern en cada estilo, el
// contorno en world3d.js) por si se vuelve a pedir ese look; acá simplemente
// no se usa: `pattern: null` en todo y solo 2 tonos, mayoría del color
// oscuro tipo "noche" (índigo) con un acento cálido (marrón/terracota) de
// vez en cuando, igual que el skyline de referencia. roughness/metalness ya
// casi no inciden en el resultado visual (la fachada es una sola cara plana
// de frente a cámara, sin variación de sombreado dentro de la cara).
// un solo color, '#241a33' — el mismo hex exacto que usaba drawGenericBuilding()
// en la versión 2D original (index-2d-legacy-backup.html, commit 9a2c4ab): ahí
// NUNCA hubo variedad de color entre edificios, todos el mismo índigo oscuro.
// Lo que en la referencia se ve como bloques marrones de fondo NO es un
// edificio con otro color: es la silueta lejana en paralaje (más abajo en este
// archivo), semitransparente sobre el naranja del horizonte — eso es lo que
// hay que replicar ahí, no acá.
const WALL_STYLES = [{ color: '#241a33', roughness: 0.95, metalness: 0, pattern: null }];

function tintedWallColor(seedX){
  const r = makeRng(Math.floor(seedX * 7));
  const hueShift = r();
  return WALL_STYLES[Math.floor(hueShift * WALL_STYLES.length)];
}

function makeFacadeMaterial(width, height, style, seed){
  const { mapTex, emTex } = makeFacadeTextures(seed);
  const repCols = Math.max(1, Math.round(width / 40)), repRows = Math.max(1, Math.round(height / 45));
  mapTex.repeat.set(repCols, repRows);
  emTex.repeat.set(repCols, repRows);
  // acepta un string (color plano, criterio viejo) o un objeto de estilo
  // {color, roughness, metalness, pattern} (criterio nuevo, ver WALL_STYLES)
  // — así los landmarks pueden seguir pasando su propio hex sin romper la
  // firma (quedan sin `map`, pared lisa, como antes).
  const isStyleObj = typeof style === 'object' && style !== null;
  const baseColor = isStyleObj ? style.color : style;
  const roughness = isStyleObj && style.roughness != null ? style.roughness : 0.9;
  const metalness = isStyleObj && style.metalness != null ? style.metalness : 0.03;
  const pattern = isStyleObj ? style.pattern : null;
  // sin bumpMap: la superficie queda perfectamente plana a propósito (look
  // cartoon), y de paso es una textura menos por edificio para samplear.
  const params = {
    color: baseColor,
    map: mapTex, // el hueco de ventana en sí — visible siempre, no solo cuando "prendida"
    emissive: new THREE.Color('#6a4a1e'),
    emissiveMap: emTex,
    emissiveIntensity: 0.5,
    roughness, metalness,
  };
  if (pattern){
    // el ladrillo/bloque de Kenney (ronda "Jetpack Joyride", sin usar en el
    // look actual) pisaría el mismo slot `map` que la grilla de ventanas de
    // arriba — no hay forma de combinar ambos sin hornearlos en una sola
    // textura, así que si algún estilo pide patrón, gana el patrón (permite
    // retomar ese look sin tener que tocar esta función otra vez).
    const base = pattern === 'brick' ? brickPatternTex : blockPatternTex;
    const map = base.clone();
    map.needsUpdate = true;
    // 1 "ladrillo" cada ~18-22 unidades de mundo: suficientemente chico para
    // leerse como mampostería real a la distancia de juego, sin volverse un
    // ruido ilegible en edificios angostos.
    map.repeat.set(Math.max(1, Math.round(width / 20)), Math.max(1, Math.round(height / 18)));
    params.map = map;
  }
  return new THREE.MeshStandardMaterial(params);
}

// ---------------------------------------------------------------------------
// detalle de techos: antenas (con o sin cruceta), tanques de agua (cilindro +
// remate cónico, referencia genérica de azotea neoyorquina, sin marca
// puntual) y alguna paloma quieta — variación de edificio a edificio, no en
// todos (≈50% de los genéricos se queda sin nada). Los landmarks (Empire/WTC/
// Times) ya tienen su propio remate y no pasan por acá.
// ---------------------------------------------------------------------------
const roofAntennaMat = new THREE.MeshStandardMaterial({ color: '#585c66', metalness: 0.85, roughness: 0.3 });
const roofAntennaGeo = new THREE.CylinderGeometry(0.3, 0.3, 1, 5);
const roofAntennaCrossGeo = new THREE.BoxGeometry(1, 0.22, 0.22);
const tankBodyMat = new THREE.MeshStandardMaterial({ color: '#6b4a34', roughness: 0.85 });
const tankCapMat = new THREE.MeshStandardMaterial({ color: '#463427', roughness: 0.9 });
const tankBodyGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
const tankCapGeo = new THREE.ConeGeometry(1, 1, 10);
const pigeonMat = new THREE.MeshStandardMaterial({ color: '#332f38', roughness: 0.8 });
const pigeonBodyGeo = new THREE.SphereGeometry(0.6, 6, 5);
const pigeonHeadGeo = new THREE.SphereGeometry(0.32, 6, 5);
// props de techo: geometría/material COMPARTIDOS entre todos los edificios que
// tocan cada tipo (ver addRoofProps abajo, siempre referencia estos mismos
// objetos, nunca los clona) — el dispose de un edificio removido NUNCA debe
// tocar estos, o rompe el render de cualquier OTRO edificio que siga vivo y
// use el mismo prop.
const SHARED_ROOF_GEOMETRIES = new Set([roofAntennaGeo, roofAntennaCrossGeo, tankBodyGeo, tankCapGeo, pigeonBodyGeo, pigeonHeadGeo]);
const SHARED_ROOF_MATERIALS = new Set([roofAntennaMat, tankBodyMat, tankCapMat, pigeonMat]);

function addRoofProps(group, b){
  const rng = makeRng(Math.floor(b.x * 3.1) + 500);
  // tier low: cada prop de techo es un Mesh propio (no instanced) — más
  // edificios "limpios" y como mucho 1 prop por techo recorta draw calls
  // que escalan 1:1 con edificios visibles en pantalla.
  const propChance = isLowTier ? 0.25 : 0.5;
  if (rng() > propChance) return;
  const roofY = b.height / 2 + 6; // arriba de la moldura (cap)
  const halfW = Math.max(4, b.width / 2 - 8);
  const halfD = Math.max(4, BUILDING_DEPTH / 2 - 8);
  const propCount = isLowTier ? 1 : (1 + (rng() > 0.6 ? 1 : 0));
  for (let i = 0; i < propCount; i++){
    const kind = rng();
    const px = (rng() * 2 - 1) * halfW;
    const pz = -BUILDING_DEPTH / 2 + (rng() * 2 - 1) * halfD;
    if (kind < 0.4){
      const h = 8 + rng() * 14;
      const antenna = new THREE.Mesh(roofAntennaGeo, roofAntennaMat);
      antenna.scale.set(1, h, 1);
      antenna.position.set(px, roofY + h / 2, pz);
      group.add(antenna);
      if (rng() > 0.5){
        const crossW = 3 + rng() * 2;
        const cross = new THREE.Mesh(roofAntennaCrossGeo, roofAntennaMat);
        cross.scale.set(crossW, 1, 1);
        cross.position.set(px, roofY + h * 0.7, pz);
        group.add(cross);
      }
    } else if (kind < 0.78){
      const tankR = 3 + rng() * 1.5;
      const tankH = 6 + rng() * 3;
      const tank = new THREE.Mesh(tankBodyGeo, tankBodyMat);
      tank.scale.set(tankR, tankH, tankR);
      tank.position.set(px, roofY + tankH / 2, pz);
      group.add(tank);
      const coneH = tankH * 0.55;
      const cone = new THREE.Mesh(tankCapGeo, tankCapMat);
      cone.scale.set(tankR * 1.15, coneH, tankR * 1.15);
      cone.position.set(px, roofY + tankH + coneH / 2, pz);
      group.add(cone);
    } else {
      const body = new THREE.Mesh(pigeonBodyGeo, pigeonMat);
      body.scale.set(1, 0.72, 1.4);
      body.position.set(px, roofY + 0.45, pz);
      group.add(body);
      const head = new THREE.Mesh(pigeonHeadGeo, pigeonMat);
      head.position.set(px + 0.55, roofY + 0.85, pz + 0.35);
      group.add(head);
    }
  }
}

// ---------------------------------------------------------------------------
// escalera de incendio (fire escape) y balcones: el detalle de fachada más
// "característico de Nueva York" que pedía el usuario, además de la ventana
// en sí. Geometría/material COMPARTIDOS entre todos los edificios que la
// usan (una sola BoxGeometry(1,1,1), escalada por instancia con .scale.set) —
// mismo criterio que los props de techo de arriba: barato en draw calls y
// nunca se dispone en el remove de un edificio individual.
// ---------------------------------------------------------------------------
const fireEscapeMat = new THREE.MeshStandardMaterial({ color: '#23222a', roughness: 0.7, metalness: 0.35 });
const fireEscapeGeo = new THREE.BoxGeometry(1, 1, 1);
const balconyMat = new THREE.MeshStandardMaterial({ color: '#2e2b38', roughness: 0.8, metalness: 0.1 });
SHARED_ROOF_GEOMETRIES.add(fireEscapeGeo);
SHARED_ROOF_MATERIALS.add(fireEscapeMat).add(balconyMat);

function bar(geo, mat, sx, sy, sz, x, y, z, rz){
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  if (rz) m.rotation.z = rz;
  return m;
}

// escalera de incendio de hierro: columna de descansos (landings) con
// baranda + tramos diagonales entre uno y el siguiente, corrida sobre un
// borde del frente del edificio, sobresaliendo levemente hacia la calle
// (Z > 0, frente al plano z=0 de la física — puramente decorativo, la
// física no mira geometría 3D, solo b.x/b.width/b.height). Devuelve true si
// agregó una (para no amontonarla con un balcón en el mismo edificio).
function addFireEscape(group, b, rng){
  if (isLowTier || b.height < 200 || b.width < 55) return false;
  if (rng() > 0.4) return false;
  const side = rng() > 0.5 ? 1 : -1;
  const localX = side * (b.width / 2 - 14);
  const floorSpacing = 42;
  const startY = -b.height / 2 + 26;
  const endY = b.height / 2 - 24;
  const floors = Math.floor((endY - startY) / floorSpacing);
  if (floors < 2) return false;
  const run = side * 9; // desplazamiento horizontal del tramo diagonal
  let y = startY;
  for (let i = 0; i < floors; i++){
    group.add(bar(fireEscapeGeo, fireEscapeMat, 15, 1.2, 7, localX, y, 5));       // descanso (landing)
    group.add(bar(fireEscapeGeo, fireEscapeMat, 0.8, 6.5, 0.8, localX - 6.5, y + 3.2, 8));  // baranda izq
    group.add(bar(fireEscapeGeo, fireEscapeMat, 0.8, 6.5, 0.8, localX + 6.5, y + 3.2, 8));  // baranda der
    group.add(bar(fireEscapeGeo, fireEscapeMat, 15, 0.7, 0.7, localX, y + 6.2, 8));         // pasamanos
    if (i < floors - 1){
      const len = Math.hypot(floorSpacing, run);
      group.add(bar(fireEscapeGeo, fireEscapeMat, 2.4, len, 1, localX + run / 2, y + floorSpacing / 2, 5,
        -Math.sign(run) * Math.atan2(Math.abs(run), floorSpacing)));
    }
    y += floorSpacing;
  }
  return true;
}

// balcones sueltos (menos "escalera completa", más departamento con balcón
// individual) — en edificios sin escalera de incendio, para variar.
function addBalconies(group, b, rng){
  if (isLowTier || b.width < 50) return;
  if (rng() > 0.35) return;
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++){
    const side = rng() > 0.5 ? 1 : -1;
    const localX = side * (b.width / 2 - 12) * (0.55 + rng() * 0.4);
    const y = -b.height / 2 + 36 + rng() * Math.max(20, b.height - 90);
    group.add(bar(fireEscapeGeo, balconyMat, 13, 1.4, 6.5, localX, y, 4.2));       // piso del balcón
    group.add(bar(fireEscapeGeo, balconyMat, 13, 4.5, 0.7, localX, y + 2.8, 7.2)); // baranda frontal
  }
}

// ---------------------------------------------------------------------------
// edificio genérico: caja lisa (sin moldura, look "silueta plana" de
// referencia) + detalle de fachada característico de Nueva York — ventana
// marcada (siempre visible, ver makeFacadeTextures), escalera de incendio o
// balcones en algunos, y props de techo (antena/tanque de agua/paloma) en
// otros — variación edificio a edificio, no todos tienen de todo.
// ---------------------------------------------------------------------------
function buildGeneric(b){
  const group = new THREE.Group();
  const wallColor = tintedWallColor(b.x);
  const seed = Math.floor(b.x * 13.7) + 101;
  const mat = makeFacadeMaterial(b.width, b.height, wallColor, seed);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, BUILDING_DEPTH), mat);
  mesh.position.z = -BUILDING_DEPTH / 2;
  mesh.receiveShadow = true; mesh.castShadow = true;
  group.add(mesh);
  // seed distinto al de addRoofProps (+500) para que no arranquen
  // correlacionados (mismo primer número random en ambas tiradas).
  const detailRng = makeRng(Math.floor(b.x * 3.1) + 700);
  if (!addFireEscape(group, b, detailRng)) addBalconies(group, b, detailRng);
  addRoofProps(group, b);
  return { group, warmMats: [mat] };
}

// ---------------------------------------------------------------------------
// Empire State: referencia propia — torre escalonada + antena, sin calcar
// el edificio real.
// ---------------------------------------------------------------------------
function buildEmpire(b){
  const group = new THREE.Group();
  const warmMats = [];
  // piedra clara cálida (tipo caliza) en los tres escalones, en vez del
  // violeta apagado — tonos ligeramente distintos entre escalones para dar
  // algo de relieve, todos dentro de la misma familia "maqueta pulida".
  const stepStyles = [
    { color: '#f5dd6e', roughness: 0.9, metalness: 0.02, pattern: null },
    { color: '#f0cf4a', roughness: 0.88, metalness: 0.02, pattern: null },
    { color: '#e8c02e', roughness: 0.86, metalness: 0.03, pattern: null },
  ];
  const steps = [
    { w: b.width, h: b.height * 0.55, y: 0 },
    { w: b.width * 0.68, h: b.height * 0.3, y: b.height * 0.55 },
    { w: b.width * 0.4, h: b.height * 0.15, y: b.height * 0.85 },
  ];
  // positionBuildingMesh() ubica el origen local del grupo en el CENTRO
  // vertical del edificio (groundY - height/2), igual que buildGeneric/buildWtc
  // (BoxGeometry centrada en su propio origen). Acá el acumulador apilaba los
  // escalones desde 0 hacia arriba -> el origen local terminaba en la BASE,
  // no el centro, y todo el edificio quedaba flotando exactamente height/2 por
  // encima de la calle (bug real, confirmado: para un Empire de 773.5 de alto
  // flotaba 386.8 — la mitad exacta). Arrancar en -height/2 alinea el origen
  // local con el centro, igual que el resto de los edificios.
  let acc = -b.height / 2;
  for (let i = 0; i < steps.length; i++){
    const s = steps[i];
    const seed = Math.floor(b.x * 13.7) + Math.round(acc) + 7;
    const mat = makeFacadeMaterial(s.w, s.h, stepStyles[i], seed);
    warmMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, BUILDING_DEPTH * (s.w / b.width)), mat);
    mesh.position.set(0, acc + s.h / 2, -BUILDING_DEPTH * (s.w / b.width) / 2);
    mesh.receiveShadow = true; mesh.castShadow = true;
    group.add(mesh);
    acc += s.h;
  }
  const antennaMat = new THREE.MeshStandardMaterial({ color: '#c9c9d4', metalness: 0.85, roughness: 0.22 });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, b.height * 0.14, 8), antennaMat);
  antenna.position.set(0, acc + (b.height * 0.14) / 2, -8);
  group.add(antenna);
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ff4d4d', toneMapped: false });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), beaconMat);
  beacon.position.set(0, acc + b.height * 0.14, -8);
  group.add(beacon);
  return { group, warmMats };
}

// ---------------------------------------------------------------------------
// One WTC: referencia propia — aguja de vidrio muy alta y angosta.
// ---------------------------------------------------------------------------
function buildWtc(b){
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: '#19c8f0', metalness: 0.5, roughness: 0.1,
    emissive: '#1e6a7c', emissiveIntensity: 0.3,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.width), mat);
  mesh.position.set(0, 0, -b.width / 2);
  mesh.receiveShadow = true; mesh.castShadow = true;
  const spireMat = new THREE.MeshStandardMaterial({ color: '#eef0f5', metalness: 0.6, roughness: 0.25 });
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.4, b.height * 0.1, 6), spireMat);
  spire.position.set(0, b.height / 2 + (b.height * 0.1) / 2, -b.width / 2);
  group.add(mesh, spire);
  return { group, warmMats: [] };
}

// ---------------------------------------------------------------------------
// Times Square: referencia propia — fachada ancha y baja + grilla de carteles
// de neón emisivos (semilla estable por edificio, sin marcas reales).
// ---------------------------------------------------------------------------
function buildTimes(b){
  const group = new THREE.Group();
  // se queda oscura (telón de fondo para que el neón lea bien de noche),
  // plana y mate — sin el brillo tipo vidrio de oficina de la ronda anterior.
  const wallMat = new THREE.MeshStandardMaterial({ color: '#241c30', roughness: 0.92, metalness: 0.03 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, BUILDING_DEPTH), wallMat);
  wall.position.z = -BUILDING_DEPTH / 2;
  wall.receiveShadow = true; wall.castShadow = true;
  group.add(wall);

  const neonColors = ['#ff3d6a', '#4dd0e1', '#ffd166', '#7cff5a', '#c17cff', '#ff8a3d'];
  const rng = makeRng(Math.floor(b.x));
  const cols = Math.max(3, Math.floor(b.width / 34));
  const rows = Math.max(2, Math.floor(b.height / 40));
  for (let r = 0; r < rows; r++){
    for (let c = 0; c < cols; c++){
      if (rng() > 0.72) continue;
      const w = 14 + rng() * 16;
      const h = 8 + rng() * 10;
      const color = neonColors[Math.floor(rng() * neonColors.length)];
      const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const x = -b.width / 2 + (c + 0.5) * (b.width / cols) + (rng() - 0.5) * 6;
      const y = -b.height / 2 + (r + 0.5) * (b.height / rows) + (rng() - 0.5) * 6;
      sign.position.set(x, y, 0.6);
      sign.userData.blinkPhase = rng() * 10;
      sign.userData.blinkSpeed = 0.5 + rng() * 1.5;
      group.add(sign);
      group.userData.neonSigns = group.userData.neonSigns || [];
      group.userData.neonSigns.push(sign);
    }
  }
  return { group, warmMats: [] };
}

function makeBuildingMesh(b){
  let rec;
  if (b.landmark === 'empire') rec = buildEmpire(b);
  else if (b.landmark === 'wtc') rec = buildWtc(b);
  else if (b.landmark === 'times') rec = buildTimes(b);
  else rec = buildGeneric(b);
  cityGroup.add(rec.group);
  return rec;
}

function positionBuildingMesh(rec, b){
  const centerWorldY = state.groundY - b.height / 2;
  rec.group.position.copy(worldToScene(b.x + b.width / 2, centerWorldY, 0));
}

const meshByBuilding = new Map();

// ---------------------------------------------------------------------------
// piso + carriles (guiones, en vez de una franja continua)
// ---------------------------------------------------------------------------
const groundMat = new THREE.MeshStandardMaterial({ color: '#141018', roughness: 0.95 });
// centrado en z=-260 (antes -180): con ese valor el frente del bloque quedaba
// en z=+20, POR DELANTE del frente de los edificios (z=0) — eso es lo que
// hacía que autos/peatones/árboles, apenas un poco detrás de los edificios,
// quedaran enterrados dentro del propio bloque de calle. Ahora el frente
// queda en z=-60 (a la par del fondo de los edificios), dejando todo el
// rango [-60, 0] libre para la vida de calle sin conflicto.
const groundGeo = new THREE.BoxGeometry(6000, 40, 400);
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.receiveShadow = true;
cityGroup.add(groundMesh);

const DASH_COUNT = 24, DASH_W = 26, DASH_GAP = 20;
const dashMat = new THREE.MeshBasicMaterial({ color: '#ffff50', transparent: true, opacity: 0.6 });
const dashGeo = new THREE.BoxGeometry(DASH_W, 3, 4);
const dashes = [];
for (let i = 0; i < DASH_COUNT; i++){
  const m = new THREE.Mesh(dashGeo, dashMat);
  cityGroup.add(m);
  dashes.push(m);
}

// ---------------------------------------------------------------------------
// domo de cielo: plano dimensionado EXACTO al frustum en su profundidad, para
// que el gradiente no quede aplastado contra un plano de tamaño arbitrario.
// ---------------------------------------------------------------------------
const SKY_DEPTH = 2400;
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    cTop: { value: new THREE.Color('#3a7bd5') },
    cMid: { value: new THREE.Color('#6dc0e0') },
    cLow: { value: new THREE.Color('#bfe8f0') },
    cHorizon: { value: new THREE.Color('#eaf8fb') },
  },
  vertexShader: `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform vec3 cTop, cMid, cLow, cHorizon;
    void main(){
      float t = vUv.y; // 1 = arriba de pantalla, 0 = horizonte/piso
      vec3 col;
      if (t > 0.55) col = mix(cMid, cTop, (t - 0.55) / 0.45);
      else if (t > 0.25) col = mix(cLow, cMid, (t - 0.25) / 0.30);
      else col = mix(cHorizon, cLow, t / 0.25);
      // bruma de piso: el tramo final hacia el horizonte se oscurece hacia un
      // gris-violeta apagado en vez de quedar en el color de horizonte puro
      // (muy claro de día) — evita que se vea como un brillo pegado a la calle
      // en los huecos entre edificios.
      if (t < 0.09) col = mix(vec3(0.075, 0.065, 0.095), col, t / 0.09);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  depthWrite: false, depthTest: false, side: THREE.DoubleSide,
});
const skyPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), skyMat);
skyPlane.renderOrder = -10;
cityGroup.add(skyPlane);

// sol / luna
const sunMat = new THREE.MeshBasicMaterial({ color: '#fff0c8', toneMapped: false, transparent: true, opacity: 0.95 });
const sunHaloMat = new THREE.MeshBasicMaterial({ color: '#ffd68f', toneMapped: false, transparent: true, opacity: 0.35, depthWrite: false });
const moonMat = new THREE.MeshBasicMaterial({ color: '#ebf0ff', toneMapped: false, transparent: true, opacity: 0.9 });
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 24), sunMat);
const sunHalo = new THREE.Mesh(new THREE.CircleGeometry(1, 24), sunHaloMat);
sunDisc.renderOrder = -9; sunHalo.renderOrder = -9;
cityGroup.add(sunHalo, sunDisc);

// estrellas (solo visibles de noche)
const STAR_COUNT = 180;
const starPositions = new Float32Array(STAR_COUNT * 3);
for (let i = 0; i < STAR_COUNT; i++){
  starPositions[i*3] = (i * 137) % 2000 - 1000;
  starPositions[i*3+1] = 80 + ((i * 59) % 900);
  starPositions[i*3+2] = -SKY_DEPTH + 40;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeo.frustumCulled = false;
const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 3, transparent: true, opacity: 0, sizeAttenuation: false });
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false;
cityGroup.add(stars);

// skyline lejano en paralaje: también lleva el mosaico de ventanas (mismo
// generador que los edificios interactivos, con un color base más oscuro,
// afín a la silueta que ya tenía). Los props de techo (antenas/tanques/
// palomas) se quedan afuera acá a propósito: a esa escala y distancia serían
// sub-píxel, no aportan y sí suman drawcalls por edificio.
// tier low: cada edificio de skyline es un Mesh + textura propios (no
// instanced, ver comentario debajo) — menos unidades bajan tanto draw calls
// como memoria de textura, a costa de un skyline algo menos denso.
const SKYLINE_COUNT = isLowTier ? 8 : 14;
const skylineMeshes = [];
for (let i = 0; i < SKYLINE_COUNT; i++){
  const h = 90 + ((i * 97) % 220);
  // silueta lisa, sin ventanas — igual que drawBuildings() en la versión 2D
  // original (un solo fillRect semitransparente por edificio de fondo, sin
  // mosaico de ventanas). El color se recalcula cada frame en update() como
  // una mezcla opaca contra el tono bajo del cielo (ver comentario ahí) para
  // fingir el mismo efecto de superposición semitransparente del 2D sin
  // meter objetos transparentes reales en el pipeline (eso rompería el orden
  // de dibujado: Three.js pinta la cola "transparent" siempre después de la
  // opaca, sin importar la profundidad real, y este skyline quedaría por
  // ENCIMA de los edificios de primer plano en vez de detrás).
  const mat = new THREE.MeshBasicMaterial({ color: '#140a23' });
  const m = new THREE.Mesh(new THREE.BoxGeometry(170, h, 40), mat);
  m.userData.h = h;
  cityGroup.add(m);
  skylineMeshes.push(m);
}

// ---------------------------------------------------------------------------
// calle con vida: autos y peatones REALES (modelos glTF de Kenney.nl, CC0,
// vendorizados en vendor/kenney/) en vez de geometría procedural — la
// geometría hecha a mano (cajas/cápsulas) nunca llegaba a verse bien sin
// importar cuánto se ajustaran los materiales; esto lo resuelve de raíz.
// 100% decorativo: nada de esto colisiona con el jugador ni participa de
// ninguna mecánica, solo se reposiciona en el update() de este módulo.
//
// Como cada modelo trae varias piezas/materiales propios (no una única
// geometría uniforme), ya NO entran en el patrón de InstancedMesh de antes
// (que asumía una sola geometría/material compartido por pieza). Cada
// instancia en pantalla es un `.clone()` real de la escena cargada — barato:
// Object3D.clone() sigue compartiendo la MISMA geometría/material entre
// todas las instancias, solo duplica la jerarquía de transform (unas pocas
// mallas por auto/persona × ~10-16 instancias, bien lejos de los ~330
// objetos que ya maneja el resto de la escena sin problema).
// ---------------------------------------------------------------------------
// usado por los árboles más abajo (InstancedMesh, sin tocar en este pase).
const _dummy = new THREE.Object3D();

const gltfLoader = new GLTFLoader();
function loadModel(url){
  return new Promise((resolve, reject) => gltfLoader.load(url, gltf => resolve(gltf.scene), undefined, reject));
}

// tier low: menos instancias vivas a la vez — menos clones para reposicionar
// por frame (CPU) y menos overdraw en pantalla, mismo criterio que el resto
// del archivo (ya no ahorra "draw calls por instancia" como el InstancedMesh
// viejo, pero cada auto/persona sigue siendo un puñado fijo de mallas).
const CAR_COUNT = isLowTier ? 6 : 10;
const PED_COUNT = isLowTier ? 10 : 16;

// tamaño real de estos modelos (metros-ish, convención Kenney) contra un
// héroe de ~50 unidades de alto: sedan mide ~1.3 de alto crudo -> escala para
// llevarlo a ~45 (auto real, apenas más bajo que el héroe, bastante más
// largo). Los personajes "Mini" son low-poly estilo chibi (achaparrados,
// ~0.67 de alto x 0.77 de ancho) — se escalan a ~38 (un poco más bajos que el
// héroe, para que lean como gente de fondo, no como el protagonista).
const CAR_MODEL_SCALE = 35;
const PED_MODEL_SCALE = 55;
// el frente de estos modelos mira +Z en su espacio local (confirmado: Z es
// la dimensión más grande del auto, el eje largo) — nuestro mundo avanza en
// X, así que hay que rotar 90° además de espejar según la dirección.
const FORWARD_OFFSET = Math.PI / 2;

const CAR_MODEL_FILES = ['sedan', 'taxi', 'police', 'hatchback-sports', 'van', 'suv-luxury'];
const PED_MODEL_FILES = ['character-male-a', 'character-male-b', 'character-male-c', 'character-female-a', 'character-female-b', 'character-female-c'];

let carTemplates = null, pedTemplates = null;
const modelsReady = Promise.all([
  Promise.all(CAR_MODEL_FILES.map(f => loadModel(`/vendor/kenney/car-kit/${f}.glb`))),
  Promise.all(PED_MODEL_FILES.map(f => loadModel(`/vendor/kenney/mini-characters/${f}.glb`))),
]).then(([carsLoaded, pedsLoaded]) => {
  carTemplates = carsLoaded;
  pedTemplates = pedsLoaded;
}).catch(err => {
  // si por lo que sea el modelo no carga (ej. deploy sin la carpeta vendor/kenney
  // subida), la calle se queda sin autos/gente en vez de romper el resto del
  // juego — mejor degradar que crashear.
  console.error('No se pudieron cargar los modelos de Kenney (autos/gente):', err);
});

function makeCarInstance(i){
  const tpl = carTemplates[i % carTemplates.length];
  const inst = tpl.clone();
  inst.scale.setScalar(CAR_MODEL_SCALE);
  cityGroup.add(inst);
  return inst;
}
function makePedInstance(i){
  const tpl = pedTemplates[i % pedTemplates.length];
  // los personajes de "Mini Characters" vienen con esqueleto/huesos (pack
  // pensado para animación) — un `.clone()` normal NO re-liga el esqueleto
  // clonado a los huesos clonados (bug clásico de Three.js: el SkinnedMesh
  // clonado sigue apuntando a los huesos del original, que nunca se agregan
  // a la escena y por lo tanto nunca actualizan su matrixWorld) — el grupo
  // contenedor quedaba bien posicionado, pero la malla en sí no se veía.
  // `SkeletonUtils.clone()` es la utilidad de Three.js que sí re-liga todo
  // correctamente. Los autos (sin huesos) no tienen este problema.
  const inst = cloneSkinned(tpl);
  inst.scale.setScalar(PED_MODEL_SCALE);
  cityGroup.add(inst);
  return inst;
}

const cars = [];
for (let i = 0; i < CAR_COUNT; i++){
  const dir = i % 2 === 0 ? 1 : -1;
  cars.push({
    x: (i - CAR_COUNT / 2) * 420 + ((i * 53) % 200),
    // z positivo: por DELANTE del frente de los edificios (z=0), nunca detrás
    // — en z negativo cualquier auto que cruzara por delante de un edificio
    // quedaba tapado por su fachada.
    z: 10 + (i % 3) * 16,
    dir,
    speed: (1.6 + (i % 4) * 0.55) * dir,
    mesh: null,
  });
}

const peds = [];
for (let i = 0; i < PED_COUNT; i++){
  const dir = i % 2 === 0 ? 1 : -1;
  peds.push({
    x: (i - PED_COUNT / 2) * 220 + ((i * 37) % 140),
    // z positivo: vereda por delante del frente de los edificios (mismo
    // motivo que los autos — nunca detrás de una fachada).
    z: 4 + (i % 4) * 6,
    dir,
    speed: (0.32 + (i % 3) * 0.14) * dir,
    phase: i * 1.7,
    mesh: null,
  });
}

// ---------------------------------------------------------------------------
// árboles de calle: puro relleno de color/vida al nivel de la vereda (pide la
// referencia "SimCity" — verde intercalado entre edificios). Mismo criterio
// que autos/peatones arriba: pool fijo vía InstancedMesh (tronco + copa,
// 2 draw calls totales sin importar cuántos árboles haya) y reposicionados en
// update() a partir de un slot de mundo determinístico (mismo patrón que los
// guiones de carril `dashes`: no "caminan" como los autos, solo aparecen en
// una grilla fija de X de mundo a medida que la cámara se desplaza, con
// semilla estable por slot — makeRng — para que no cambien de aspecto al
// volver a pasar por el mismo tramo). Puramente decorativo: no tocan
// sceneZ=0 ni la física de edificios.
// ---------------------------------------------------------------------------
const TREE_SPACING = 150;
// tier low: mismo criterio que CAR_COUNT/PED_COUNT — menos instancias vivas a
// la vez, menos matrices a recalcular por frame.
const TREE_COUNT = isLowTier ? 12 : 22;
const TREE_CANOPY_COLORS = [0x3fae4a, 0x4cbb5a, 0x2f8f3d, 0x5ac95a, 0x2f7a44].map(c => new THREE.Color(c));

// deforma levemente los vértices de una geometría COMPARTIDA, una sola vez al
// cargar el módulo (mismo patrón que jitterGeometry en enemies3d.js) — rompe
// la silueta de esfera perfecta de la copa sin costo por instancia ni por
// frame: todas las copas comparten esta misma geometría "esculpida".
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

const treeTrunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6);
// jitter de geometría (silueta orgánica simple): se deja, da variedad de
// forma sin verse como una textura realista — es la única capa de "detalle"
// que sobrevive de la ronda anterior en los árboles.
const treeCanopyGeo = jitterGeometry(new THREE.SphereGeometry(1, 10, 8), 0.14);
// tronco y follaje: color plano saturado, sin bumpMap de corteza ni textura
// de manchas de follaje — la variedad de tono entre árboles ya la da
// TREE_CANOPY_COLORS por instancia.
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a28', roughness: 0.9, metalness: 0.02 });
const treeCanopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02 });
const treeTrunkMesh = new THREE.InstancedMesh(treeTrunkGeo, treeTrunkMat, TREE_COUNT);
const treeCanopyMesh = new THREE.InstancedMesh(treeCanopyGeo, treeCanopyMat, TREE_COUNT);
treeTrunkMesh.frustumCulled = false; treeCanopyMesh.frustumCulled = false;
cityGroup.add(treeTrunkMesh, treeCanopyMesh);

function updateTrees(){
  const startSlot = Math.floor((state.cameraX - TREE_SPACING * 2) / TREE_SPACING);
  for (let i = 0; i < TREE_COUNT; i++){
    const slot = startSlot + i;
    const worldX = slot * TREE_SPACING;
    const rng = makeRng(slot * 31 + 900);
    // escala real: contra un héroe de ~50 de alto, un árbol de calle tiene
    // que rondar 2-3 veces su altura, no ser un arbusto (mismo bug de escala
    // que autos/peatones — el rango viejo (7-12 tronco, 5-8 copa) daba
    // árboles de ~20-30 de alto en total).
    const trunkH = 22 + rng() * 12;
    const canopyR = 16 + rng() * 9;
    // capa cercana: por DELANTE del frente de los edificios (mismo motivo que
    // autos/peatones — antes, en z negativo, quedaba tapada por cualquier
    // edificio con el que compartiera x). Capa lejana: decorativa, pegada al
    // fondo de los edificios, se ve solo en los huecos entre uno y otro.
    const z = rng() > 0.5 ? 6 + rng() * 10 : -66 - rng() * 10;
    const scenePos = worldToScene(worldX, state.groundY, z);

    _dummy.position.set(scenePos.x, scenePos.y + trunkH / 2, scenePos.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, trunkH, 1);
    _dummy.updateMatrix();
    treeTrunkMesh.setMatrixAt(i, _dummy.matrix);

    _dummy.position.set(scenePos.x, scenePos.y + trunkH + canopyR * 0.75, scenePos.z);
    _dummy.scale.set(canopyR, canopyR * 1.15, canopyR);
    _dummy.updateMatrix();
    treeCanopyMesh.setMatrixAt(i, _dummy.matrix);
    const toneIdx = ((slot % TREE_CANOPY_COLORS.length) + TREE_CANOPY_COLORS.length) % TREE_CANOPY_COLORS.length;
    treeCanopyMesh.setColorAt(i, TREE_CANOPY_COLORS[toneIdx]);
  }
  treeTrunkMesh.instanceMatrix.needsUpdate = true;
  treeCanopyMesh.instanceMatrix.needsUpdate = true;
  if (treeCanopyMesh.instanceColor) treeCanopyMesh.instanceColor.needsUpdate = true;
}

function updateCars(sky){
  if (!carTemplates) return; // modelos todavía cargando (o no disponibles) — sin autos por ahora, no crashea
  const MARGIN = 400, RESPAWN_SPAN = 1600;
  for (let i = 0; i < cars.length; i++){
    const c = cars[i];
    if (!c.mesh) c.mesh = makeCarInstance(i);
    c.x += c.speed;
    if (c.dir > 0 && c.x > state.cameraX + state.W + MARGIN){
      c.x = state.cameraX - RESPAWN_SPAN - Math.random() * 300;
    } else if (c.dir < 0 && c.x < state.cameraX - RESPAWN_SPAN){
      c.x = state.cameraX + state.W + MARGIN + Math.random() * 300;
    }
    // el origen local del modelo ya está a nivel de rueda — anclar a groundY
    // exacto, NO groundY+18 (ese offset era para la línea de carril del canvas
    // 2D original; acá hundía el auto entero dentro del bloque de la calle).
    const scenePos = worldToScene(c.x, state.groundY, c.z);
    c.mesh.position.copy(scenePos);
    c.mesh.rotation.set(0, (c.dir > 0 ? 0 : Math.PI) + FORWARD_OFFSET, 0);
  }
}

function updatePeds(tsec){
  if (!pedTemplates) return; // modelos todavía cargando (o no disponibles)
  const MARGIN = 300, RESPAWN_SPAN = 1100;
  for (let i = 0; i < peds.length; i++){
    const p = peds[i];
    if (!p.mesh) p.mesh = makePedInstance(i);
    p.x += p.speed;
    if (p.dir > 0 && p.x > state.cameraX + state.W + MARGIN){
      p.x = state.cameraX - RESPAWN_SPAN - Math.random() * 250;
    } else if (p.dir < 0 && p.x < state.cameraX - RESPAWN_SPAN){
      p.x = state.cameraX + state.W + MARGIN + Math.random() * 250;
    }
    const bob = Math.sin(tsec * 3.2 + p.phase) * 0.5 * (PED_MODEL_SCALE / 12);
    const scenePos = worldToScene(p.x, state.groundY, p.z);
    p.mesh.position.set(scenePos.x, scenePos.y + bob, scenePos.z);
    p.mesh.rotation.set(0, (p.dir > 0 ? 0 : Math.PI) + FORWARD_OFFSET, 0);
  }
}

// margen fuera de los bordes visibles donde igual se sigue dibujando un
// edificio (evita que aparezca/desaparezca de golpe justo en el borde de
// pantalla) — más allá de esto, ni siquiera vale la pena el draw call.
const VISIBILITY_MARGIN = 150;

export function update(){
  const alive = new Set();
  for (const b of state.buildings){
    alive.add(b);
    let rec = meshByBuilding.get(b);
    if (!rec){
      rec = makeBuildingMesh(b);
      meshByBuilding.set(b, rec);
    }
    // costo real de CPU: state.js mantiene edificios "en cola" bastante más
    // allá del borde de cámara (para que el streaming no se note) — sin este
    // corte, cada uno de esos ya se estaba dibujando en cada frame aunque no
    // se viera nada. `visible=false` en Three.js salta el draw call entero.
    rec.group.visible = b.x + b.width > state.cameraX - VISIBILITY_MARGIN &&
                         b.x < state.cameraX + state.W + VISIBILITY_MARGIN;
    if (rec.group.visible) positionBuildingMesh(rec, b);
  }
  for (const [b, rec] of meshByBuilding){
    if (!alive.has(b)){
      cityGroup.remove(rec.group);
      // los props de techo (antenas/tanques/palomas) usan geometría/material
      // COMPARTIDOS entre edificios (ver SHARED_ROOF_* arriba) — nunca disponer
      // esos acá. La textura de ventanas (emissiveMap) SÍ es única por edificio
      // (windowTexture() genera un CanvasTexture nuevo cada vez) y material.dispose()
      // no la libera solo — hay que disponerla a mano o queda filtrando GPU/canvas
      // memory edificio tras edificio. El `map` de ladrillo/bloque es un
      // `.clone()` del patrón compartido (brickPatternTex/blockPatternTex) solo
      // para poder tener su propio `repeat` — dispose() acá libera nada más la
      // textura GPU de ESE clon, no la imagen fuente compartida.
      rec.group.traverse(o => {
        if (o.geometry && !SHARED_ROOF_GEOMETRIES.has(o.geometry)) o.geometry.dispose();
        if (o.material && !SHARED_ROOF_MATERIALS.has(o.material)){
          if (o.material.emissiveMap) o.material.emissiveMap.dispose();
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      meshByBuilding.delete(b);
    }
  }

  const sky = getSkyState(state.elapsedFrames);
  const tsec = performance.now() / 1000;
  const warmth = sky.isNight ? 1.35 : 0.5;
  for (const rec of meshByBuilding.values()){
    if (!rec.group.visible) continue; // fuera de cámara: no vale la pena animar ventanas/neón
    for (const mat of rec.warmMats) mat.emissiveIntensity = warmth;
    if (rec.group.userData.neonSigns){
      for (const sign of rec.group.userData.neonSigns){
        const blink = 0.55 + 0.45 * Math.sin(tsec * sign.userData.blinkSpeed + sign.userData.blinkPhase);
        sign.material.opacity = 1;
        sign.scale.setScalar(0.9 + blink * 0.15);
      }
    }
  }

  // piso: sigue a la cámara en X, ancho fijo generoso
  const groundCenter = worldToScene(state.cameraX + state.W / 2, state.groundY + 20, -260);
  groundMesh.position.copy(groundCenter);

  const dashSpacing = DASH_W + DASH_GAP;
  const startX = state.cameraX - dashSpacing;
  for (let i = 0; i < dashes.length; i++){
    const wx = startX + i * dashSpacing - (state.cameraX % dashSpacing);
    // groundY+18 quedaba hundido dentro del bloque sólido de la calle (mismo
    // bug que autos/peatones) — apenas por encima de la superficie y unos
    // units por delante del frente de la calle para evitar z-fighting.
    dashes[i].position.copy(worldToScene(wx, state.groundY - 1, 25));
  }

  // cámara / frustum actual (para dimensionar el domo exacto)
  const camScene = worldToScene(state.cameraX + state.W / 2, state.H / 2);
  const camDist = camDistanceForHeight(state.H);
  const totalDist = camDist + SKY_DEPTH;
  const halfH = totalDist * Math.tan(FOV_Y_RAD / 2);
  const halfW = halfH * (state.W / state.H);
  skyPlane.scale.set(halfW * 2, halfH * 2, 1);
  skyPlane.position.set(camScene.x, camScene.y, -SKY_DEPTH);

  skyMat.uniforms.cTop.value.set(sky.top);
  skyMat.uniforms.cMid.value.set(sky.mid);
  skyMat.uniforms.cLow.value.set(sky.low);
  skyMat.uniforms.cHorizon.value.set(sky.horizon);

  // sol/luna: mismo arco que usa world3d.js para la luz direccional
  const sunWorldX = state.cameraX + sky.sunX01 * state.W * 1.3 - state.W * 0.15;
  const sunWorldY = state.H * 0.16 + (1 - sky.arcH) * state.H * 0.24;
  const discScene = worldToScene(sunWorldX, sunWorldY, -SKY_DEPTH + 60);
  const discScale = totalDist * 0.028;
  sunDisc.position.copy(discScene); sunDisc.scale.setScalar(discScale);
  sunHalo.position.copy(discScene); sunHalo.scale.setScalar(discScale * 2.3);
  sunDisc.material = sky.sunHalf ? sunMat : moonMat;

  starMat.opacity = sky.isNight ? 0.15 + sky.arcH * 0.7 : 0;
  const starScene = worldToScene(state.cameraX + state.W / 2, state.H * 0.1, -SKY_DEPTH + 40);
  stars.position.x = starScene.x;

  // skyline lejano en paralaje: se mueve a una fracción de cameraX (no es un
  // objeto de mundo real, así que se posiciona directo en espacio de escena
  // en vez de pasar por worldToScene) para dar sensación de profundidad.
  const parSpacing = 260;
  const parBase = state.cameraX * 0.25;
  const startIndex = Math.floor(parBase / parSpacing) - Math.floor(SKYLINE_COUNT / 2);
  // mezcla opaca contra sky.low (el tono del cielo bajo, justo donde vive
  // este skyline) — imita a mano el mismo `rgba(20,10,35,.55)` día /
  // `rgba(5,5,15,.65)` noche semitransparente de la versión 2D original
  // (ver comentario en la creación de skylineMeshes más arriba sobre por qué
  // no es transparencia real). De día el tinte queda más claro/azulado
  // (mezcla con el celeste del cielo diurno); al atardecer, al mezclarse con
  // el naranja del horizonte, da justo ese marrón apagado de la referencia.
  const skylineTint = sky.isNight ? '#05050f' : '#140a23';
  const skylineAlpha = sky.isNight ? 0.65 : 0.55;
  const skylineColor = lerpHexToHexString(sky.low, skylineTint, skylineAlpha);
  for (let i = 0; i < skylineMeshes.length; i++){
    const m = skylineMeshes[i];
    const sceneX = (startIndex + i) * parSpacing;
    const sceneY = -(state.groundY - m.userData.h / 2);
    m.position.set(sceneX, sceneY, -700);
    m.material.color.set(skylineColor);
  }

  // calle con vida (autos + peatones): puramente decorativo, ver bloque de
  // definición arriba — no toca colisión ni estado de juego.
  updateCars(sky);
  updatePeds(tsec);
  updateTrees();
}
