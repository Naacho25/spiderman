// ============================================================================
// Raíz de composición: conecta estado/física (state.js) con el motor 3D
// (world3d.js) y los módulos de arte (hero/city/enemies3d/vfx). No hay lógica
// de juego acá — solo orden de arranque y el loop de cada frame.
// ============================================================================

import * as state from './state.js';
import * as ui from './ui.js';
import * as world3d from './world3d.js';
import * as hero from './hero.js';
import * as city from './city.js';
import * as enemies3d from './enemies3d.js';
import * as vfx from './vfx.js';

// el input ahora se resuelve con un raycast 3D real en vez del viejo mapeo trivial
state.setRaycaster(world3d.raycastFromClient);

// Blindaje del loop: si CUALQUIER update() de un frame tira una excepción no
// contemplada (más probable en mobile, donde aparecen casos límite no
// probados), antes el juego entero se congelaba en silencio (dejaba de pedir
// el próximo requestAnimationFrame). Ahora se loguea y se sigue pidiendo el
// próximo frame (el juego puede degradar mejor que trabarse en seco) — salvo
// que el error se repita muchísimas veces seguidas, en cuyo caso se corta para
// no quedar en un loop de excepciones infinito gastando batería.
const MAX_CONSECUTIVE_ERRORS = 30;
let consecutiveErrors = 0;

function showFatalErrorOverlay(){
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'flex-direction:column;gap:10px;padding:24px;box-sizing:border-box;text-align:center;' +
    'background:#0a0612;color:#fff;font-family:"Segoe UI",Arial,sans-serif;z-index:9999;';
  msg.innerHTML = '<div style="font-size:22px;font-weight:800;">😕 Algo salió mal</div>' +
    '<div style="font-size:15px;color:#ccc;max-width:420px;">Trepamuros encontró un error y tuvo que detenerse. ' +
    'Probá recargar la página.</div>';
  document.body.appendChild(msg);
}

function frame(){
  try {
    if (!state.paused) state.update();
    hero.update();
    city.update();
    enemies3d.update();
    vfx.update();
    ui.updateHud();
    world3d.render();
    consecutiveErrors = 0;
  } catch (e) {
    consecutiveErrors++;
    console.error('Error en el frame del juego:', e);
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS){
      showFatalErrorOverlay();
      return; // corta el loop: no pide más requestAnimationFrame
    }
  }
  requestAnimationFrame(frame);
}

let started = false;
function startLoop(){
  if (started) return;
  started = true;
  state.setRunning(true);
  requestAnimationFrame(frame);
}

ui.initUI({ onPlay: startLoop });
state.initGame();
