// A câmara do editor é feita de CÉLULAS numa grade, como no editor do Portal 2:
// você abre (ou fecha) células e pinta as faces; as paredes aparecem sozinhas.
//
//   chamber = { open: ['i,j,k', …], paint: { 'i,j,k,f': 'white'|'metal'|'glass' } }
//   f = face da célula aberta: 0 +x · 1 −x · 2 +y (teto) · 3 −y (chão) · 4 +z · 5 −z
//
// A célula (i, j, k) ocupa x ∈ [4i−2, 4i+2], y ∈ [4j, 4j+4], z ∈ [4k−2, 4k+2]:
// o centro de (0,0,0) fica no chão da origem.

import * as THREE from 'three';

export const CELL = 4;
export const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const OPP = [1, 0, 3, 2, 5, 4];
export const PAINTS = [
  ['white', 'Aceita portal'],
  ['metal', 'Não aceita portal'],
  ['glass', 'Vidro'],
];
export const DEFAULT_PAINT = 'white';

export const cellKey = (i, j, k) => `${i},${j},${k}`;
export const parseKey = (s) => s.split(',').map(Number);
export const cellMin = (i, j, k) => [i * CELL - CELL / 2, j * CELL, k * CELL - CELL / 2];
export const cellCenter = (i, j, k) => [i * CELL, j * CELL + CELL / 2, k * CELL];
/** célula que contém o ponto */
export const cellOf = (x, y, z) => [Math.floor((x + CELL / 2) / CELL), Math.floor(y / CELL), Math.floor((z + CELL / 2) / CELL)];

export function newChamber() {
  return { open: [cellKey(0, 0, 0), cellKey(0, 0, -1)], paint: {} };
}

export const isOpen = (ch, i, j, k) => ch.open.includes(cellKey(i, j, k));

export function setOpen(ch, i, j, k, on) {
  const key = cellKey(i, j, k);
  const has = ch.open.includes(key);
  if (on && !has) ch.open.push(key);
  else if (!on && has) {
    ch.open.splice(ch.open.indexOf(key), 1);
    for (let f = 0; f < 6; f++) delete ch.paint[`${key},${f}`];
  }
  return on !== has;
}

export const paintOf = (ch, i, j, k, f) => ch.paint[`${cellKey(i, j, k)},${f}`] ?? DEFAULT_PAINT;

/** caixa que envolve as células abertas (para enquadrar a câmera) */
export function chamberBounds(ch) {
  const box = new THREE.Box3();
  for (const s of ch.open) {
    const [i, j, k] = parseKey(s);
    const m = cellMin(i, j, k);
    box.expandByPoint(new THREE.Vector3(...m));
    box.expandByPoint(new THREE.Vector3(m[0] + CELL, m[1] + CELL, m[2] + CELL));
  }
  return box;
}

/**
 * Constrói as paredes: toda célula FECHADA encostada (até na diagonal) numa aberta vira
 * um bloco do tamanho de uma célula; as faces voltadas para dentro levam a tinta, o resto some.
 * Devolve quantos blocos fez.
 */
export function buildChamber(w, ch) {
  const open = new Set(ch.open);
  const shell = new Set();
  for (const s of open) {
    const [i, j, k] = parseKey(s);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const key = cellKey(i + dx, j + dy, k + dz);
          if (!open.has(key)) shell.add(key);
        }
  }
  for (const s of shell) {
    const [i, j, k] = parseKey(s);
    const faces = FACE_DIRS.map(([dx, dy, dz], f) => {
      const n = cellKey(i + dx, j + dy, k + dz);
      return open.has(n) ? ch.paint[`${n},${OPP[f]}`] ?? DEFAULT_PAINT : null;
    });
    const m = cellMin(i, j, k);
    const b = w.importedBox(new THREE.Vector3(...m), new THREE.Vector3(m[0] + CELL, m[1] + CELL, m[2] + CELL), faces);
    b.mesh.userData.cell = [i, j, k]; // o editor esconde o teto/andares de cima
    b.mesh.userData.vis = b.mesh.visible;
  }
  return shell.size;
}

/** luzes de teto automáticas: uma por célula aberta com teto fechado (no máximo `max`, espalhadas) */
export function autoLights(w, ch, max = 14, intensity = 9) {
  const open = new Set(ch.open);
  const cells = [...open].map(parseKey).filter(([i, j, k]) => !open.has(cellKey(i, j + 1, k)));
  const step = Math.max(1, Math.ceil(cells.length / max));
  cells.forEach(([i, j, k], n) => {
    if (n % step) return;
    const c = cellCenter(i, j, k);
    w.light(c[0], j * CELL + CELL - 0.35, c[2], intensity, 0xfff4e6, 13);
  });
}
