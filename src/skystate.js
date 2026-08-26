// Matemática pura de ciclo día/noche — sin dependencia de Three.js ni del DOM.
// Consumida tanto por world3d.js (luz direccional/niebla) como por city.js (ventanas/neón)
// para que nunca haya dos sistemas de día/noche divergiendo entre sí.

export const DAY_CYCLE_FRAMES = 60 * 260; // ciclo completo ~260s

export const SKY_FRAMES = [
  { p:0.00, top:'#f4a259', mid:'#e08a5c', low:'#f7c893', horizon:'#ffe3b0', sun:true },  // amanecer
  { p:0.28, top:'#3a7bd5', mid:'#6dc0e0', low:'#bfe8f0', horizon:'#eaf8fb', sun:true },  // día
  { p:0.52, top:'#2b1055', mid:'#6a3a7a', low:'#e0724f', horizon:'#f4a259', sun:true },  // atardecer
  { p:0.75, top:'#050914', mid:'#0d1633', low:'#141d3d', horizon:'#1f2a52', sun:false }, // noche
  { p:1.00, top:'#f4a259', mid:'#e08a5c', low:'#f7c893', horizon:'#ffe3b0', sun:true },  // vuelve al amanecer
];

export function lerpHex(a, b, t){
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar=(pa>>16)&255, ag=(pa>>8)&255, ab=pa&255;
  const br=(pb>>16)&255, bg=(pb>>8)&255, bb=pb&255;
  const r = Math.round(ar+(br-ar)*t), g = Math.round(ag+(bg-ag)*t), b2 = Math.round(ab+(bb-ab)*t);
  return `rgb(${r},${g},${b2})`;
}

// devuelve hex "#rrggbb" en vez de "rgb(...)" — útil para pasar directo a THREE.Color
export function lerpHexToHexString(a, b, t){
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar=(pa>>16)&255, ag=(pa>>8)&255, ab=pa&255;
  const br=(pb>>16)&255, bg=(pb>>8)&255, bb=pb&255;
  const r = Math.round(ar+(br-ar)*t), g = Math.round(ag+(bg-ag)*t), b2 = Math.round(ab+(bb-ab)*t);
  return '#' + ((1<<24) + (r<<16) + (g<<8) + b2).toString(16).slice(1);
}

/**
 * @param {number} elapsedFrames
 * @returns {{top,mid,low,horizon,isNight,cyclePos,sunHalf,arcH,sunX01,sunY01}}
 *   sunX01/sunY01: posición del sol/luna en el arco, normalizada 0..1 (para ubicar la luz direccional)
 */
export function getSkyState(elapsedFrames){
  const cyclePos = (elapsedFrames % DAY_CYCLE_FRAMES) / DAY_CYCLE_FRAMES;
  let a = SKY_FRAMES[0], b = SKY_FRAMES[SKY_FRAMES.length - 1];
  for (let i = 0; i < SKY_FRAMES.length - 1; i++){
    if (cyclePos >= SKY_FRAMES[i].p && cyclePos <= SKY_FRAMES[i+1].p){
      a = SKY_FRAMES[i]; b = SKY_FRAMES[i+1];
      break;
    }
  }
  const span = (b.p - a.p) || 1;
  const t = (cyclePos - a.p) / span;

  const sunHalf = cyclePos < 0.5;
  const local = sunHalf ? cyclePos/0.5 : (cyclePos-0.5)/0.5;
  const arcH = Math.sin(local * Math.PI);

  return {
    top: lerpHexToHexString(a.top, b.top, t),
    mid: lerpHexToHexString(a.mid, b.mid, t),
    low: lerpHexToHexString(a.low, b.low, t),
    horizon: lerpHexToHexString(a.horizon, b.horizon, t),
    isNight: !a.sun && !b.sun,
    cyclePos, sunHalf, arcH,
    sunX01: local, sunY01: 1 - arcH,
  };
}
