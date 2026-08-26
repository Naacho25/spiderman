// ============================================================================
// Ciudad: edificios (incl. landmarks) + piso. Versión esqueleto (Fase 1) —
// cajas con textura de ventanas procedural; el pase de arte real (Empire State
// escalonado, aguja del WTC, neón animado de Times Square, instancing) llega
// en la Fase 2. Lee skystate.js, nunca la redefine (evita divergencia día/noche
// con world3d.js).
//
// REGLA DURA: el frente de cada edificio (con el que interactúa la física) debe
// quedar exactamente en sceneZ = 0. Solo se puede extruir hacia atrás (-Z).
// ============================================================================

import * as THREE from '../vendor/three/build/three.module.js';
import { cityGroup, worldToScene } from './world3d.js';
import { getSkyState } from './skystate.js';
import * as state from './state.js';

const BUILDING_DEPTH = 60;

function windowTexture(){
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#241a33';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffe9a8';
  for (let r = 0; r < 8; r++){
    for (let col = 0; col < 8; col++){
      if ((r + col) % 3 === 0) continue;
      ctx.fillRect(col*8 + 2, r*8 + 2, 4, 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const winTex = windowTexture();

const LANDMARK_COLOR = { empire: '#3a3550', wtc: '#8fd0e6', times: '#2a2438', null: '#2c2438' };

const meshByBuilding = new Map();

function makeBuildingMesh(b){
  const tex = winTex.clone();
  tex.needsUpdate = true;
  const repX = Math.max(1, Math.round(b.width / 26));
  const repY = Math.max(1, Math.round(b.height / 30));
  tex.repeat.set(repX, repY);
  const mat = new THREE.MeshStandardMaterial({
    color: LANDMARK_COLOR[b.landmark] || LANDMARK_COLOR.null,
    emissive: new THREE.Color('#332200'),
    emissiveMap: tex,
    emissiveIntensity: 0.4,
    roughness: 0.75, metalness: 0.1,
  });
  const geo = new THREE.BoxGeometry(b.width, b.height, BUILDING_DEPTH);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  cityGroup.add(mesh);
  return mesh;
}

function positionBuildingMesh(mesh, b){
  const centerWorldY = state.groundY - b.height / 2;
  const scenePos = worldToScene(b.x + b.width / 2, centerWorldY, -BUILDING_DEPTH / 2);
  mesh.position.copy(scenePos);
}

// ---------- piso ----------
const groundMat = new THREE.MeshStandardMaterial({ color: '#141018', roughness: 0.9 });
const groundGeo = new THREE.BoxGeometry(6000, 40, 400);
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.receiveShadow = true;
cityGroup.add(groundMesh);

const laneMat = new THREE.MeshBasicMaterial({ color: '#ffff50', transparent: true, opacity: 0.55 });
const laneGeo = new THREE.BoxGeometry(6000, 3, 4);
const laneMesh = new THREE.Mesh(laneGeo, laneMat);
cityGroup.add(laneMesh);

export function update(){
  const alive = new Set();
  for (const b of state.buildings){
    alive.add(b);
    let mesh = meshByBuilding.get(b);
    if (!mesh){
      mesh = makeBuildingMesh(b);
      meshByBuilding.set(b, mesh);
    }
    positionBuildingMesh(mesh, b);
  }
  for (const [b, mesh] of meshByBuilding){
    if (!alive.has(b)){
      cityGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      meshByBuilding.delete(b);
    }
  }

  const groundCenter = worldToScene(state.cameraX + state.W / 2, state.groundY + 20, -180);
  groundMesh.position.copy(groundCenter);
  const laneCenter = worldToScene(state.cameraX + state.W / 2, state.groundY + 18, 0);
  laneMesh.position.copy(laneCenter);

  const sky = getSkyState(state.elapsedFrames);
  const warmth = sky.isNight ? 1.1 : 0.35;
  for (const mesh of meshByBuilding.values()){
    mesh.material.emissiveIntensity = warmth;
  }
}
