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
import { cityGroup, scene, worldToScene, camera, FOV_Y_RAD, camDistanceForHeight, qualityTier } from './world3d.js';
import { getSkyState } from './skystate.js';
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
function windowTexture(seed, bgColor){
  const c = document.createElement('canvas');
  const SIZE = TEX_SIZE;
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bgColor || '#0e0a16';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // suciedad/manchado de fachada: manchurrones sutiles de humedad/hollín
  // ANTES de dibujar las ventanas, para que la piedra entre vidrios no quede
  // perfectamente pareja — edificios reales tienen chorreaduras y diferencias
  // de tono aun sin ser un edificio "viejo".
  const grimeRng = makeRng(seed + 4001);
  const grimeCount = isLowTier ? 3 : 7;
  for (let i = 0; i < grimeCount; i++){
    const gx = grimeRng() * SIZE, gy = grimeRng() * SIZE;
    const gr = SIZE * (0.1 + grimeRng() * 0.24);
    const dark = grimeRng() > 0.45;
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grad.addColorStop(0, dark ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }

  // pilastra vertical sutil, para romper la fachada lisa
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(SIZE * 0.47, 0, SIZE * 0.06, SIZE);

  const rng = makeRng(seed);
  const cols = TEX_COLS, rows = TEX_ROWS;
  const cw = SIZE / cols, ch = SIZE / rows;
  for (let r = 0; r < rows; r++){
    for (let col = 0; col < cols; col++){
      if ((r + col) % 3 === 0) continue; // hueco estructural entre ventanas
      const isLit = rng() > 0.6;
      const wx = col * cw + cw * 0.18, wy = r * ch + ch * 0.18;
      const ww = cw * 0.64, wh = ch * 0.64;

      // marco: rectángulo un poco más grande y más oscuro DETRÁS del vidrio,
      // para simular el relieve/sombra del marco en vez de un vidrio
      // flotando directo sobre la fachada.
      const frameM = Math.min(ww, wh) * 0.14;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(wx - frameM, wy - frameM, ww + frameM * 2, wh + frameM * 2);

      if (isLit){
        // contraste más amplio ventana a ventana: no todas al mismo brillo
        // "on" — algunas apenas tenues, otras casi al máximo.
        const bright = 0.4 + rng() * 0.6;
        ctx.fillStyle = `rgba(255,242,194,${bright.toFixed(2)})`;
        ctx.fillRect(wx, wy, ww, wh);
      } else {
        // "apagada": casi negra, con variación sutil de tono para que la
        // fachada no quede como un bloque perfectamente liso de día
        const bright = 0.04 + rng() * 0.10;
        ctx.fillStyle = `rgba(130,140,170,${bright.toFixed(2)})`;
        ctx.fillRect(wx, wy, ww, wh);
        // reflejo de cielo: gradiente vertical tenue (más claro/frío arriba,
        // se apaga hacia abajo) sobre el vidrio apagado, para que lea como
        // cristal reflejando el cielo en vez de un agujero negro plano.
        const skyGrad = ctx.createLinearGradient(0, wy, 0, wy + wh);
        skyGrad.addColorStop(0, 'rgba(205,222,255,0.18)');
        skyGrad.addColorStop(1, 'rgba(205,222,255,0)');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(wx, wy, ww, wh);
      }

      // "gente": silueta simple sobre algunas ventanas prendidas
      if (isLit && rng() > 0.62){
        ctx.fillStyle = 'rgba(8,6,10,0.8)';
        ctx.beginPath();
        ctx.ellipse(wx + ww * 0.5, wy + wh * 0.62, ww * 0.22, wh * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(wx + ww * 0.5, wy + wh * 0.3, ww * 0.15, wh * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// ruido en escala de grises para usar como bumpMap (mismo patrón que
// rhinoSkinBump en enemies3d.js): rompe la superficie perfectamente lisa de
// piedra/hormigón, corteza de árbol y goma de neumático sin geometría extra.
// Generada UNA sola vez al cargar el módulo — nunca dentro de update().
// ---------------------------------------------------------------------------
function grayNoiseTexture(size, contrast){
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4){
    const v = Math.min(255, Math.max(0, 128 + (Math.random() - 0.5) * 255 * contrast));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// bump de piedra/hormigón para fachadas: ruido chico repetido varias veces
// por pared, tier low usa una textura más chica (menos costo de subida a GPU).
const stoneBumpTex = grayNoiseTexture(isLowTier ? 32 : 64, 0.55);
stoneBumpTex.repeat.set(6, 6);

// paleta "maqueta pulida" tipo SimCity: piedra clara, ladrillo/terracota,
// tostados cálidos y vidrio verde-azulado/celeste saturado, en vez de una
// única familia oscura violeta/azul. Cada tono trae su propio roughness/
// metalness — piedra y ladrillo más mate, vidrio más brillante — para que el
// acabado varíe junto con el color, no solo el hue.
// roughness/metalness ajustados a comportamiento físico real por material:
// piedra/hormigón/ladrillo son dieléctricos rugosos (roughness alto, casi sin
// metalness) y el vidrio es liso y algo reflectivo (roughness bajo, metalness
// medio-alto) — antes todo vivía en un rango angosto (0.2-0.55) que hacía que
// piedra y vidrio se comportaran casi igual ante la luz. `bump: true` marca
// los estilos "sólidos" que reciben el ruido de piedra (stoneBumpTex); el
// vidrio se queda liso a propósito.
const WALL_STYLES = [
  { color: '#e4ddc9', roughness: 0.82, metalness: 0.03, bump: true },  // piedra clara / crema
  { color: '#c7ccd1', roughness: 0.78, metalness: 0.04, bump: true },  // gris claro piedra
  { color: '#b5563a', roughness: 0.8, metalness: 0.02, bump: true },   // ladrillo terracota
  { color: '#8f6a45', roughness: 0.76, metalness: 0.03, bump: true },  // marrón tostado cálido
  { color: '#5fb8ad', roughness: 0.1, metalness: 0.6, bump: false },   // vidrio verde-azulado
  { color: '#79c3e0', roughness: 0.08, metalness: 0.65, bump: false }, // vidrio celeste
  { color: '#d8b98a', roughness: 0.74, metalness: 0.03, bump: true },  // tostado/crema cálido
  { color: '#3f6e5c', roughness: 0.12, metalness: 0.55, bump: false }, // vidrio verde oscuro
  { color: '#c4443a', roughness: 0.35, metalness: 0.2, bump: false },  // panel esmaltado rojo/naranja (raro, tipo landmark)
];

function tintedWallColor(seedX){
  const r = makeRng(Math.floor(seedX * 7));
  const hueShift = r();
  return WALL_STYLES[Math.floor(hueShift * WALL_STYLES.length)];
}

function makeFacadeMaterial(width, height, style, seed){
  const tex = windowTexture(seed);
  tex.repeat.set(Math.max(1, Math.round(width / 40)), Math.max(1, Math.round(height / 45)));
  // acepta un string (color plano, criterio viejo) o un objeto de estilo
  // {color, roughness, metalness} (criterio nuevo, ver WALL_STYLES) — así los
  // landmarks pueden seguir pasando su propio hex sin romper la firma.
  const isStyleObj = typeof style === 'object' && style !== null;
  const baseColor = isStyleObj ? style.color : style;
  const roughness = isStyleObj && style.roughness != null ? style.roughness : 0.4;
  const metalness = isStyleObj && style.metalness != null ? style.metalness : 0.15;
  // ruido de piedra/hormigón vía bumpMap: mismo criterio que rhinoSkinBump en
  // enemies3d.js (canvas de ruido gris, reutilizado por todas las fachadas
  // "sólidas" — no se genera una textura nueva por edificio, es la misma
  // instancia de stoneBumpTex, solo cambia si el material la usa o no).
  const useBump = !isStyleObj || style.bump !== false;
  const params = {
    color: baseColor,
    emissive: new THREE.Color('#4a3418'),
    emissiveMap: tex,
    emissiveIntensity: 0.5,
    roughness, metalness,
  };
  if (useBump){
    params.bumpMap = stoneBumpTex;
    params.bumpScale = 0.6;
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
// edificio genérico: caja + moldura superior más clara para romper la silueta
// ---------------------------------------------------------------------------
function buildGeneric(b){
  const group = new THREE.Group();
  const wallColor = tintedWallColor(b.x);
  const seed = Math.floor(b.x * 13.7) + 101;
  const mat = makeFacadeMaterial(b.width, b.height, wallColor, seed);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, BUILDING_DEPTH), mat);
  mesh.position.z = -BUILDING_DEPTH / 2;
  mesh.receiveShadow = true; mesh.castShadow = true;
  const capMat = new THREE.MeshStandardMaterial({ color: '#eef0ee', roughness: 0.35, metalness: 0.2 });
  const cap = new THREE.Mesh(new THREE.BoxGeometry(b.width + 4, 6, BUILDING_DEPTH + 4), capMat);
  cap.position.set(0, b.height / 2 + 3, -BUILDING_DEPTH / 2);
  group.add(mesh, cap);
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
    { color: '#ecdfc3', roughness: 0.8, metalness: 0.03 },
    { color: '#e3d5b0', roughness: 0.78, metalness: 0.03 },
    { color: '#ddd0ab', roughness: 0.76, metalness: 0.04 },
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
    color: '#5fd0e8', metalness: 0.85, roughness: 0.08,
    emissive: '#1e4a5c', emissiveIntensity: 0.3,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.width, b.height, b.width), mat);
  mesh.position.set(0, 0, -b.width / 2);
  mesh.receiveShadow = true; mesh.castShadow = true;
  const spireMat = new THREE.MeshStandardMaterial({ color: '#eef0f5', metalness: 0.88, roughness: 0.12 });
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
  // se queda oscura (telón de fondo para que el neón lea bien de noche) pero
  // menos plana/mate que antes, con un toque de brillo tipo vidrio de oficina.
  const wallMat = new THREE.MeshStandardMaterial({ color: '#2a2233', roughness: 0.55, metalness: 0.15 });
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
  const seed = i * 733 + 19;
  const tex = windowTexture(seed, '#140f22');
  tex.repeat.set(4, Math.max(1, Math.round(h / 45)));
  const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', map: tex });
  const m = new THREE.Mesh(new THREE.BoxGeometry(170, h, 40), mat);
  m.userData.h = h;
  cityGroup.add(m);
  skylineMeshes.push(m);
}

// ---------------------------------------------------------------------------
// calle con vida: autos y peatones de fondo. 100% decorativo — nada de esto
// colisiona con el jugador ni participa de ninguna mecánica, solo se
// reposiciona en el update() de este módulo. Pool fijo reciclado (se
// resetean al salir del rango de la cámara, igual criterio que el skyline en
// paralaje) y todo vía InstancedMesh: 10 autos + 16 peatones terminan siendo
// un puñado de draw calls en vez de uno por pieza, para no golpear el
// framerate en mobile.
// ---------------------------------------------------------------------------
const _dummy = new THREE.Object3D();
const _offsetMat = new THREE.Matrix4();
const _composedMat = new THREE.Matrix4();

// tier low: menos instancias == menos matrices que recalcular por frame en
// updateCars/updatePeds (CPU) y menos overdraw de carrocería/cuerpos en
// pantalla a la vez (fill-rate) — el InstancedMesh ya mantiene el draw call
// en 1 por pieza sea cual sea el conteo, así que esto no ahorra draw calls,
// ahorra CPU y overdraw.
const CAR_COUNT = isLowTier ? 6 : 10;
const CAR_COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x8d99a3, 0x27ae60, 0x8e44ad, 0xe67e22, 0xecf0f1];
// geometrías con el offset local ya "horneado" (translate/rotate en la propia
// geometría) así todas las piezas de un auto comparten la misma matriz de
// instancia por índice — sin eso, InstancedMesh no tiene jerarquía padre/hijo.
const carBodyGeo = new THREE.BoxGeometry(16, 6, 8).translate(0, 6, 0);
const carCabinGeo = new THREE.BoxGeometry(8, 4, 7).translate(-1.5, 11, 0);
const carWheelBaseGeo = new THREE.CylinderGeometry(2, 2, 1.4, 8).rotateX(Math.PI / 2);
const CAR_WHEEL_SLOTS = [[-5.5, 2, 4.3], [5.5, 2, 4.3], [-5.5, 2, -4.3], [5.5, 2, -4.3]];
const carWheelGeos = CAR_WHEEL_SLOTS.map(([ox, oy, oz]) => carWheelBaseGeo.clone().translate(ox, oy, oz));
const carLightGeo = new THREE.SphereGeometry(0.75, 6, 6);

// pintura de carrocería tipo "auto real": barniz brilloso (clearcoat) sobre
// una base metalizada, en vez de un MeshStandardMaterial mate genérico —
// MeshPhysicalMaterial.clearcoat está soportado por el three.js vendorizado
// (ver vendor/three/build/three.module.js, propiedad `clearcoat` en
// MeshPhysicalMaterial). El color por auto se sigue aplicando por instancia
// vía setColorAt más abajo, sin cambiar ese mecanismo.
const carBodyMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, roughness: 0.22, metalness: 0.6,
  clearcoat: 1, clearcoatRoughness: 0.1,
});
// vidrio de cabina como material aparte, real: oscuro, semitransparente, casi
// liso y algo reflectivo — antes era el mismo tipo de material mate que la
// carrocería, solo con un color más oscuro (no leía como vidrio).
const carCabinMat = new THREE.MeshPhysicalMaterial({
  color: '#0c1420', roughness: 0.08, metalness: 0.3,
  clearcoat: 0.6, clearcoatRoughness: 0.1,
  transparent: true, opacity: 0.62,
});
// goma de neumático: ruido gris como bumpMap (mismo patrón que stoneBumpTex
// arriba) para que la llanta no lea como un cilindro de plástico liso.
const tireBumpTex = grayNoiseTexture(isLowTier ? 24 : 48, 0.5);
tireBumpTex.repeat.set(2, 4);
const carWheelMat = new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.95, bumpMap: tireBumpTex, bumpScale: 0.4 });
const carHeadlightMat = new THREE.MeshBasicMaterial({ color: '#fff6c8', toneMapped: false, transparent: true, opacity: 0 });
const carTaillightMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', toneMapped: false, transparent: true, opacity: 0 });
// halo de luz: esfera más grande y muy transparente detrás de cada foco, para
// que de noche los faros/luces traseras lean como fuentes de luz encendidas
// (bloom "falso") y no como un punto de color plano sin brillo alrededor.
const carLightHaloGeo = new THREE.SphereGeometry(1.8, 6, 6);
const carHeadlightHaloMat = new THREE.MeshBasicMaterial({ color: '#fff6c8', toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const carTaillightHaloMat = new THREE.MeshBasicMaterial({ color: '#ff3b30', toneMapped: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

const carBodyMesh = new THREE.InstancedMesh(carBodyGeo, carBodyMat, CAR_COUNT);
const carCabinMesh = new THREE.InstancedMesh(carCabinGeo, carCabinMat, CAR_COUNT);
const carWheelMeshes = carWheelGeos.map(g => new THREE.InstancedMesh(g, carWheelMat, CAR_COUNT));
const carHeadlightMesh = new THREE.InstancedMesh(carLightGeo, carHeadlightMat, CAR_COUNT);
const carTaillightMesh = new THREE.InstancedMesh(carLightGeo, carTaillightMat, CAR_COUNT);
const carHeadlightHaloMesh = new THREE.InstancedMesh(carLightHaloGeo, carHeadlightHaloMat, CAR_COUNT);
const carTaillightHaloMesh = new THREE.InstancedMesh(carLightHaloGeo, carTaillightHaloMat, CAR_COUNT);
const carMeshes = [carBodyMesh, carCabinMesh, ...carWheelMeshes, carHeadlightMesh, carTaillightMesh, carHeadlightHaloMesh, carTaillightHaloMesh];
for (const m of carMeshes){ m.frustumCulled = false; cityGroup.add(m); }

// escala real: el auto medía 16x6x8 unidades de geometría cruda contra un
// héroe de ~50 de alto — un auto real tiene que superar al héroe en largo y
// acercársele en altura, no ser una fracción de su tamaño (bug de escala real,
// no solo estético). CAR_SCALE lleva el auto a ~120 de largo x ~45 de alto.
const CAR_SCALE = 7.5;
const cars = [];
for (let i = 0; i < CAR_COUNT; i++){
  const dir = i % 2 === 0 ? 1 : -1;
  cars.push({
    x: (i - CAR_COUNT / 2) * 420 + ((i * 53) % 200),
    // z positivo: por DELANTE del frente de los edificios (z=0), nunca detrás
    // — antes (z negativo) cualquier auto que cruzara por delante de un
    // edificio quedaba tapado por su fachada.
    z: 10 + (i % 3) * 16,
    dir,
    speed: (1.6 + (i % 4) * 0.55) * dir,
  });
  carBodyMesh.setColorAt(i, new THREE.Color(CAR_COLORS[i % CAR_COLORS.length]));
}
if (carBodyMesh.instanceColor) carBodyMesh.instanceColor.needsUpdate = true;

// tier low: mismo criterio que CAR_COUNT arriba.
const PED_COUNT = isLowTier ? 10 : 16;
// ropa (cuerpo) y piel (cabeza) ahora son dos paletas separadas en vez de un
// único tono por persona repetido en cuerpo y cabeza — así cada peatón lee
// como "una persona con ropa" y no como una figura monocromática.
const PED_CLOTH_TONES = [0x3a2e34, 0x2e2a3a, 0x332a2a, 0x2a3230, 0x35303c, 0x2f2a26, 0x4a3428, 0x263248];
const PED_SKIN_TONES = [0xc98a5c, 0xe0b088, 0x8a5a3c, 0x6b4028, 0xf0c8a0, 0xa06840];
const pedBodyGeo = new THREE.CapsuleGeometry(1.5, 5, 4, 8).translate(0, 4, 0);
const pedHeadGeo = new THREE.SphereGeometry(1.5, 8, 8).translate(0, 9.5, 0);
// textura sutil de tela sobre la "ropa": ruido chico y de bajo contraste
// (mismo patrón grayNoiseTexture que la piedra/goma) para que no lea como
// plástico liso — usa `map` en vez de bump porque a este tamaño en pantalla
// el relieve del bump no se nota, pero la variación de tono sí.
const clothTex = grayNoiseTexture(isLowTier ? 16 : 32, 0.22);
clothTex.repeat.set(2, 3);
const pedBodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, map: clothTex });
// piel: menos rugosa que la tela pero lejos de un plástico brillante.
const pedHeadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
const pedBodyMesh = new THREE.InstancedMesh(pedBodyGeo, pedBodyMat, PED_COUNT);
const pedHeadMesh = new THREE.InstancedMesh(pedHeadGeo, pedHeadMat, PED_COUNT);
pedBodyMesh.frustumCulled = false; pedHeadMesh.frustumCulled = false;
cityGroup.add(pedBodyMesh, pedHeadMesh);

// escala real: la figura medía ~11 de alto (cuerpo+cabeza) contra un héroe de
// ~50 — una persona tiene que quedar comparable en altura al héroe, no una
// fracción suya (mismo bug de escala que los autos).
const PED_SCALE = 4.2;
const peds = [];
for (let i = 0; i < PED_COUNT; i++){
  const dir = i % 2 === 0 ? 1 : -1;
  const clothTone = new THREE.Color(PED_CLOTH_TONES[i % PED_CLOTH_TONES.length]);
  const skinTone = new THREE.Color(PED_SKIN_TONES[(i * 3 + 1) % PED_SKIN_TONES.length]);
  peds.push({
    x: (i - PED_COUNT / 2) * 220 + ((i * 37) % 140),
    // z positivo: vereda por delante del frente de los edificios (mismo
    // motivo que los autos — nunca detrás de una fachada).
    z: 4 + (i % 4) * 6,
    dir,
    speed: (0.32 + (i % 3) * 0.14) * dir,
    phase: i * 1.7,
  });
  pedBodyMesh.setColorAt(i, clothTone);
  pedHeadMesh.setColorAt(i, skinTone);
}
if (pedBodyMesh.instanceColor) pedBodyMesh.instanceColor.needsUpdate = true;
if (pedHeadMesh.instanceColor) pedHeadMesh.instanceColor.needsUpdate = true;

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
const treeCanopyGeo = jitterGeometry(new THREE.SphereGeometry(1, 10, 8), 0.14);
// corteza: ruido vertical (estirado en Y) en vez del gris-marrón plano — el
// mismo canvas de ruido de stoneBumpTex/tireBumpTex, pero repetido angosto y
// alto para que lea como vetas de corteza, no como piedra.
const barkBumpTex = grayNoiseTexture(isLowTier ? 24 : 48, 0.6);
barkBumpTex.repeat.set(2, 8);
// follaje: manchas de verde en vez de un verde uniforme, para romper la
// lectura "esfera de plástico" incluso antes del jitter de geometría.
const foliageTex = (() => {
  const size = isLowTier ? 32 : 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const blobCount = isLowTier ? 40 : 90;
  for (let i = 0; i < blobCount; i++){
    const shade = 0.55 + Math.random() * 0.5;
    ctx.fillStyle = `rgba(${Math.round(180 * shade)},${Math.round(255 * shade)},${Math.round(180 * shade)},0.5)`;
    const x = Math.random() * size, y = Math.random() * size, r = 2 + Math.random() * (size * 0.09);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
})();
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 0.9, metalness: 0.02, bumpMap: barkBumpTex, bumpScale: 0.5 });
const treeCanopyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02, map: foliageTex });
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
  const MARGIN = 400, RESPAWN_SPAN = 1600; // agrandado junto con el nuevo espaciado (420) y escala (CAR_SCALE)
  carHeadlightMat.opacity = sky.isNight ? 0.9 : 0;
  carTaillightMat.opacity = sky.isNight ? 0.85 : 0;
  carHeadlightHaloMat.opacity = sky.isNight ? 0.35 : 0;
  carTaillightHaloMat.opacity = sky.isNight ? 0.3 : 0;
  for (let i = 0; i < cars.length; i++){
    const c = cars[i];
    c.x += c.speed;
    if (c.dir > 0 && c.x > state.cameraX + state.W + MARGIN){
      c.x = state.cameraX - RESPAWN_SPAN - Math.random() * 300;
    } else if (c.dir < 0 && c.x < state.cameraX - RESPAWN_SPAN){
      c.x = state.cameraX + state.W + MARGIN + Math.random() * 300;
    }
    // el origen local del modelo ya está a nivel de rueda (ver comentario más
    // arriba) — anclar a groundY exacto, NO groundY+18: ese offset (pensado
    // para la línea de carril, dibujada aparte en el canvas 2D original) acá
    // hundía el auto entero dentro del bloque sólido de la calle en 3D.
    const scenePos = worldToScene(c.x, state.groundY, c.z);
    _dummy.position.copy(scenePos);
    _dummy.rotation.set(0, c.dir > 0 ? 0 : Math.PI, 0);
    _dummy.scale.set(CAR_SCALE, CAR_SCALE, CAR_SCALE);
    _dummy.updateMatrix();
    carBodyMesh.setMatrixAt(i, _dummy.matrix);
    carCabinMesh.setMatrixAt(i, _dummy.matrix);
    for (const wm of carWheelMeshes) wm.setMatrixAt(i, _dummy.matrix);

    _offsetMat.makeTranslation(9, 5, 0);
    _composedMat.multiplyMatrices(_dummy.matrix, _offsetMat);
    carHeadlightMesh.setMatrixAt(i, _composedMat);
    carHeadlightHaloMesh.setMatrixAt(i, _composedMat);
    _offsetMat.makeTranslation(-9, 5, 0);
    _composedMat.multiplyMatrices(_dummy.matrix, _offsetMat);
    carTaillightMesh.setMatrixAt(i, _composedMat);
    carTaillightHaloMesh.setMatrixAt(i, _composedMat);
  }
  for (const m of carMeshes) m.instanceMatrix.needsUpdate = true;
}

function updatePeds(tsec){
  const MARGIN = 300, RESPAWN_SPAN = 1100; // agrandado junto con el nuevo espaciado (220) y PED_SCALE
  for (let i = 0; i < peds.length; i++){
    const p = peds[i];
    p.x += p.speed;
    if (p.dir > 0 && p.x > state.cameraX + state.W + MARGIN){
      p.x = state.cameraX - RESPAWN_SPAN - Math.random() * 250;
    } else if (p.dir < 0 && p.x < state.cameraX - RESPAWN_SPAN){
      p.x = state.cameraX + state.W + MARGIN + Math.random() * 250;
    }
    const bob = Math.sin(tsec * 3.2 + p.phase) * 0.5 * PED_SCALE;
    // mismo criterio que los autos: origen local a nivel de pie, anclar a groundY.
    const scenePos = worldToScene(p.x, state.groundY, p.z);
    _dummy.position.set(scenePos.x, scenePos.y + bob, scenePos.z);
    _dummy.rotation.set(0, p.dir > 0 ? 0 : Math.PI, 0);
    _dummy.scale.set(PED_SCALE, PED_SCALE, PED_SCALE);
    _dummy.updateMatrix();
    pedBodyMesh.setMatrixAt(i, _dummy.matrix);
    pedHeadMesh.setMatrixAt(i, _dummy.matrix);
  }
  pedBodyMesh.instanceMatrix.needsUpdate = true;
  pedHeadMesh.instanceMatrix.needsUpdate = true;
}

export function update(){
  const alive = new Set();
  for (const b of state.buildings){
    alive.add(b);
    let rec = meshByBuilding.get(b);
    if (!rec){
      rec = makeBuildingMesh(b);
      meshByBuilding.set(b, rec);
    }
    positionBuildingMesh(rec, b);
  }
  for (const [b, rec] of meshByBuilding){
    if (!alive.has(b)){
      cityGroup.remove(rec.group);
      // los props de techo (antenas/tanques/palomas) usan geometría/material
      // COMPARTIDOS entre edificios (ver SHARED_ROOF_* arriba) — nunca disponer
      // esos acá. La textura de ventanas (emissiveMap) SÍ es única por edificio
      // (windowTexture() genera un CanvasTexture nuevo cada vez) y material.dispose()
      // no la libera solo — hay que disponerla a mano o queda filtrando GPU/canvas
      // memory edificio tras edificio.
      rec.group.traverse(o => {
        if (o.geometry && !SHARED_ROOF_GEOMETRIES.has(o.geometry)) o.geometry.dispose();
        if (o.material && !SHARED_ROOF_MATERIALS.has(o.material)){
          if (o.material.emissiveMap) o.material.emissiveMap.dispose();
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
  const skylineTone = sky.isNight ? 1.1 : 0.65;
  for (let i = 0; i < skylineMeshes.length; i++){
    const m = skylineMeshes[i];
    const sceneX = (startIndex + i) * parSpacing;
    const sceneY = -(state.groundY - m.userData.h / 2);
    m.position.set(sceneX, sceneY, -700);
    m.material.color.setScalar(skylineTone);
  }

  // calle con vida (autos + peatones): puramente decorativo, ver bloque de
  // definición arriba — no toca colisión ni estado de juego.
  updateCars(sky);
  updatePeds(tsec);
  updateTrees();
}
