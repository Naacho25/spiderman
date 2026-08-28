// ============================================================================
// Motor 3D: escena/cámara/luces/postprocesado/raycasting/tiers de calidad.
// Único dueño de la cámara — vfx.js pide camera-shake vía addCameraShake(),
// nunca toca camera.position/rotation directo (evita que dos módulos peleen
// por la cámara en el mismo frame).
//
// LA REGLA DE ORO (ver plan): todo lo que la física puede tocar (frente de
// edificio, enemigos, power-ups, gancho de grúa, el propio héroe) tiene que
// vivir en sceneZ = 0. worldToScene()/raycastFromClient() son exactos en ese
// plano — es álgebra de intersección rayo-plano, no una aproximación. Solo la
// decoración pura (skyline de fondo, partículas) puede vivir en otro Z.
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { EffectComposer } from '../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/examples/jsm/postprocessing/OutputPass.js';
import { canvas, W, H, cameraX, elapsedFrames } from './state.js';
import { getSkyState } from './skystate.js';

// ---------- tier de calidad ----------
function detectQualityTier(){
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+ manda un User-Agent de escritorio (sin "iPad") por defecto —
  // sin este chequeo un iPad real cae del lado "desktop" del heurístico y
  // puede terminar en tier 'high' (sombras + bloom a resolución completa),
  // que su GPU integrada sin ventilación activa no sostiene igual que un
  // desktop de verdad. maxTouchPoints>1 en 'MacIntel' es el indicador
  // estándar para distinguir un iPad real de un Mac real.
  const isIpadOS13 = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isMobile = isMobileUA || isIpadOS13;
  const cores = navigator.hardwareConcurrency || 4;
  if (isMobile) return cores >= 6 ? 'mid' : 'low';
  return cores >= 8 ? 'high' : 'mid';
}
export const qualityTier = detectQualityTier();
// La escena real tiene ~330 mallas separadas (~17k triángulos, sin contar
// instanced meshes) — con sombras en tiempo real activadas eso significa una
// SEGUNDA pasada de render por cada una de esas ~330 mallas (el mapa de
// sombras), casi duplicando el trabajo por frame. El tier "high" las tenía
// activadas basándose solo en `hardwareConcurrency` (núcleos de CPU), que no
// dice nada de la GPU real — muchas PCs de escritorio/notebook con 8+ núcleos
// tienen GPU integrada modesta, y terminaban con la config más pesada sin
// poder sostenerla (reporte real: "todo trabado" en Chrome de escritorio).
// Hasta tener una forma confiable de medir la GPU real, sombras quedan
// apagadas en TODOS los tiers — se prioriza que ande fluido en cualquier
// Chrome/Safari por sobre el detalle de sombra proyectada. `pixelRatio` y
// `bloomRes` también bajan un escalón en mid/high por el mismo motivo
// (ambos escalan el costo de TODAS las pasadas, no solo sombras).
export const TIER = {
  low:  { pixelRatio: 1,                                  bloom: true, bloomRes: 0.4,  shadows: false, particleScale: 0.4 },
  mid:  { pixelRatio: Math.min(devicePixelRatio || 1, 1.5), bloom: true, bloomRes: 0.6,  shadows: false, particleScale: 0.75 },
  high: { pixelRatio: Math.min(devicePixelRatio || 1, 1.75), bloom: true, bloomRes: 0.85, shadows: false, particleScale: 1 },
}[qualityTier];

// ---------- chequeo de soporte antes de crear el renderer ----------
// three.js r169 requiere WebGL2 sin fallback a WebGL1 — si el navegador no lo
// soporta (iOS viejo pre-15, webviews embebidos raros), new THREE.WebGLRenderer()
// tira una excepción no capturada y la pantalla queda en negro sin explicación.
// Mejor cortar acá con un mensaje amigable en español, mismo tono que el resto.
function checkWebGL2Support(){
  try {
    const testCanvas = document.createElement('canvas');
    return !!(testCanvas.getContext('webgl2'));
  } catch (e) { return false; }
}
if (!checkWebGL2Support()){
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'flex-direction:column;gap:10px;padding:24px;box-sizing:border-box;text-align:center;' +
    'background:#0a0612;color:#fff;font-family:"Segoe UI",Arial,sans-serif;z-index:9999;';
  msg.innerHTML = '<div style="font-size:22px;font-weight:800;">😕 Tu navegador no es compatible</div>' +
    '<div style="font-size:15px;color:#ccc;max-width:420px;">Trepamuros necesita WebGL2 para funcionar. ' +
    'Probá actualizar tu navegador o abrir el juego en Chrome/Safari en su versión más reciente.</div>';
  document.body.innerHTML = '';
  document.body.appendChild(msg);
  throw new Error('WebGL2 no soportado — juego detenido antes de crear el renderer.');
}

// ---------- escena / renderer ----------
export const scene = new THREE.Scene();
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(TIER.pixelRatio);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = TIER.shadows;
if (TIER.shadows) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); }, false);
canvas.addEventListener('webglcontextrestored', () => { /* three.js re-sube texturas/estado solo en el próximo render */ }, false);

// grupos que usan los demás módulos — así cada uno gestiona su propia sub-rama
// sin tocar `scene` directamente
export const heroGroup = new THREE.Group(); scene.add(heroGroup);
export const cityGroup = new THREE.Group(); scene.add(cityGroup);
export const enemyGroup = new THREE.Group(); scene.add(enemyGroup);
export const vfxGroup = new THREE.Group(); scene.add(vfxGroup);

// ---------- cámara "2.5D": perspectiva real, pero sin roll/pitch dinámico ----------
// FOV fijo, cámara siempre perpendicular al plano de juego (z=0). Esto es lo que
// garantiza que el raycast a z=0 sea *exacto*, no una aproximación (ver arriba).
const FOV_Y_DEG = 42;
export const FOV_Y_RAD = FOV_Y_DEG * Math.PI / 180;
export const camera = new THREE.PerspectiveCamera(FOV_Y_DEG, W / H, 1, 8000);

// exportada: city.js la usa para dimensionar el domo de cielo exactamente al
// tamaño del frustum a cualquier profundidad (así el gradiente no queda
// "aplastado" contra un plano más grande que lo que realmente se ve)
export function camDistanceForHeight(h){ return (h / 2) / Math.tan(FOV_Y_RAD / 2); }

// ---------- transform mundo(x,y invertido en Y, y=abajo) <-> escena (Y arriba) ----------
export function worldToScene(x, y, z = 0){
  return new THREE.Vector3(x, -y, z);
}
export function sceneToWorld(v){
  return { x: v.x, y: -v.y };
}

// ---------- raycast de input: reemplaza al viejo worldFromClient trivial ----------
const _raycaster = new THREE.Raycaster();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0
const _hit = new THREE.Vector3();
export function raycastFromClient(clientX, clientY){
  const ndcX = (clientX / W) * 2 - 1;
  const ndcY = -((clientY / H) * 2 - 1);
  _raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  _raycaster.ray.intersectPlane(_groundPlane, _hit);
  return sceneToWorld(_hit);
}

// ---------- luces ----------
export const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
sunLight.castShadow = TIER.shadows;
if (TIER.shadows){
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 1500;
  sunLight.shadow.camera.left = -500;
  sunLight.shadow.camera.right = 500;
  sunLight.shadow.camera.top = 500;
  sunLight.shadow.camera.bottom = -500;
  sunLight.shadow.bias = -0.0015;
}
scene.add(sunLight);
scene.add(sunLight.target);

export const hemiLight = new THREE.HemisphereLight(0x8fb8ff, 0x241a33, 0.55);
scene.add(hemiLight);

export const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
scene.add(rimLight);

// gradient map compartido para todos los MeshToonMaterial (cel-shading consistente)
export const toonGradientMap = (() => {
  const data = new Uint8Array([40, 110, 180, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  return tex;
})();

scene.fog = new THREE.Fog(0x0a0612, 700, 4200);
scene.background = new THREE.Color(0x0a0612);

// ---------- postprocesado (bloom) ----------
export const composer = new EffectComposer(renderer);
composer.setPixelRatio(TIER.pixelRatio);
composer.addPass(new RenderPass(scene, camera));
export const bloomPass = new UnrealBloomPass(new THREE.Vector2(W * TIER.bloomRes, H * TIER.bloomRes), 0.85, 0.5, 0.72);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ---------- camera shake (vfx.js pide vía esto, nunca toca camera directo) ----------
let shakeAmount = 0, shakeTimer = 0, shakeDuration = 1;
export function addCameraShake(amount, durationFrames){
  shakeAmount = Math.max(shakeAmount, amount);
  shakeTimer = Math.max(shakeTimer, durationFrames);
  shakeDuration = durationFrames;
}

// ---------- resize (respeta `renderScale`, ver degradación dinámica abajo) ----------
let renderScale = 1;
export function onResize(){
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  const rw = Math.max(1, Math.round(W * renderScale));
  const rh = Math.max(1, Math.round(H * renderScale));
  renderer.setSize(rw, rh, false);
  // `setSize(..., false)` deja el tamaño CSS del canvas sin fijar — Three.js
  // solo lo hace por vos cuando ese tercer argumento es `true`. Sin esto,
  // sin ninguna regla CSS que le dé ancho/alto al <canvas>, el elemento
  // termina mostrándose a su tamaño INTRÍNSECO, que es el del buffer interno
  // (W*pixelRatio) — en cualquier pantalla con devicePixelRatio > 1 (muy
  // común: casi cualquier laptop con escalado de Windows, o cualquier
  // celular real) esto hacía que el canvas se mostrara 1.25x-3x más grande
  // de lo que ocupa la ventana, y de paso la GPU rendereaba esa misma
  // cantidad de más de píxeles en CADA pasada (escena + sombras + bloom)
  // todo el tiempo, sin que sirviera para nada — probablemente la causa más
  // grande del "anda lento" reportado en una PC de escritorio real (mi
  // entorno de pruebas tiene devicePixelRatio=1, así que nunca lo noté).
  // Fijar el tamaño CSS acá, siempre, en W/H lógicos (no en el buffer
  // reducido por `renderScale`) resuelve ambos problemas de una vez.
  renderer.domElement.style.width = W + 'px';
  renderer.domElement.style.height = H + 'px';
  composer.setSize(rw, rh);
  bloomPass.resolution.set(rw * TIER.bloomRes, rh * TIER.bloomRes);
}
addEventListener('resize', () => setTimeout(onResize, 0));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(onResize, 0); });
onResize();

// ---------- degradación dinámica de calidad ----------
// Los tiers estáticos (arriba) parten de heurísticas (User-Agent, cantidad de
// núcleos) que pueden estar equivocadas para un hardware puntual (GPU
// integrada débil, aceleración por hardware desactivada en el navegador,
// etc. — no hay forma de detectar eso de antemano). Esto mide el tiempo real
// de frame en vivo y, si el juego va lento de verdad, baja el costo de render.
//
// OJO — bug real de la primera versión de esto: medía por CANTIDAD DE FRAMES
// (esperar 120 frames de warmup + otros 90 para el primer chequeo). Con FPS
// realmente bajo (que es justo el caso que esto tiene que resolver), esos
// ~210 frames pueden tardar 20+ segundos REALES en juntarse — el jugador ya
// decidió "no es jugable" mucho antes de que el sistema llegara a reaccionar.
// Ahora warmup/chequeo son por TIEMPO REAL (`performance.now()`), no por
// cantidad de frames: reacciona en 1-2 segundos sin importar cuán lento vaya,
// y si el frame promedio es MUY malo salta varios escalones de una en vez de
// probar de a uno. Nunca vuelve a subir (evita parpadear entre calidades).
const WARMUP_MS = 1200; // ventana inicial: hitches de compilación de shaders, no cuentan
const CHECK_INTERVAL_MS = 1000; // reevalúa cada ~1s de tiempo real
const BAD_FRAME_MS = 1000 / 27; // por debajo de ~27fps sostenido, degradar
let startedAt = 0, windowStart = 0, windowFrames = 0, windowTimeSum = 0, downgradeStep = 0;
const DOWNGRADE_STEPS = [
  () => { bloomPass.enabled = false; },
  () => { renderer.setPixelRatio(1); composer.setPixelRatio(1); },
  () => { renderScale = 0.75; onResize(); },
  () => { renderScale = 0.55; onResize(); },
  () => { renderScale = 0.4; onResize(); },
];
let lastFrameAt = 0;
function reportFrameTime(){
  const now = performance.now();
  if (lastFrameAt === 0){ lastFrameAt = now; startedAt = now; windowStart = now; return; }
  const dt = now - lastFrameAt;
  lastFrameAt = now;
  if (now - startedAt < WARMUP_MS) return;
  windowFrames++;
  windowTimeSum += dt;
  if (now - windowStart < CHECK_INTERVAL_MS) return;
  const avg = windowTimeSum / Math.max(1, windowFrames);
  windowStart = now; windowFrames = 0; windowTimeSum = 0;
  if (avg <= BAD_FRAME_MS || downgradeStep >= DOWNGRADE_STEPS.length) return;
  // tan lento que ni el escalón inmediato alcanzaría (ej. <15fps): saltar
  // directo unos escalones más en vez de ir de a uno y hacer sufrir varios
  // segundos más de espera entre cada mini-mejora.
  const severity = avg > BAD_FRAME_MS * 2.2 ? 3 : avg > BAD_FRAME_MS * 1.5 ? 2 : 1;
  for (let i = 0; i < severity && downgradeStep < DOWNGRADE_STEPS.length; i++){
    DOWNGRADE_STEPS[downgradeStep]();
    downgradeStep++;
  }
}

// ---------- render loop hook ----------
export function render(){
  reportFrameTime();
  // encuadre horizontal-only, idéntico en espíritu al viejo cameraX de la
  // versión 2D: sigue al jugador, nunca cambia de pitch/roll/zoom.
  const camScene = worldToScene(cameraX + W / 2, H / 2);
  const dist = camDistanceForHeight(H);
  camera.position.set(camScene.x, camScene.y, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(camScene.x, camScene.y, 0);

  if (shakeTimer > 0){
    const fade = shakeTimer / shakeDuration;
    const a = shakeAmount * fade;
    camera.position.x += (Math.random()*2-1) * a;
    camera.position.y += (Math.random()*2-1) * a;
    shakeTimer--;
    if (shakeTimer <= 0) shakeAmount = 0;
  }

  const sky = getSkyState(elapsedFrames);
  scene.background.set(sky.top);
  scene.fog.color.set(sky.horizon);

  // sol/luna: recorre el mismo arco que en la versión 2D, ahora como luz direccional real
  const sunWorldX = cameraX + sky.sunX01 * W * 1.3 - W * 0.15;
  const sunWorldY = H * 0.16 + (1 - sky.arcH) * H * 0.24;
  const sunScene = worldToScene(sunWorldX, sunWorldY, 600);
  sunLight.position.copy(sunScene);
  sunLight.target.position.set(camScene.x, camScene.y, 0);
  sunLight.intensity = sky.isNight ? 0.25 : (0.9 + sky.arcH * 0.6);
  sunLight.color.set(sky.isNight ? 0xaac0ff : 0xfff2d9);
  rimLight.position.set(sunScene.x * -1, sunScene.y, -400);
  hemiLight.intensity = sky.isNight ? 0.35 : 0.6;

  composer.render();
}
