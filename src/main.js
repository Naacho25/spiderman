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

function frame(){
  if (!state.paused) state.update();
  hero.update();
  city.update();
  enemies3d.update();
  vfx.update();
  ui.updateHud();
  world3d.render();
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
