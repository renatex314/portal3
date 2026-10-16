// Modelos do original no Three.js: malha com esqueleto (SkinnedMesh), as
// sequências como AnimationClip e os materiais com as texturas da cópia do
// jogador (.vmt/.vtf). O objeto fica nas coordenadas do Source dentro de um
// "container" que converte para as daqui (ver placeModel).

import * as THREE from 'three';
import { decodeVTF, parseVMT, texPath } from './textures.js';

const S = 0.025;

/** materiais por nome de textura do modelo (compartilhados entre modelos) */
const matCache = new Map();
const texCache = new Map();

async function loadTexture(read, path, { srgb = true, alphaMask = false, maxSize = 1024 } = {}) {
  const key = `${path}|${srgb}|${alphaMask}`;
  if (texCache.has(key)) return texCache.get(key);
  const job = (async () => {
    const bytes = await read(`materials/${path}.vtf`);
    if (!bytes) return null;
    const img = decodeVTF(bytes, maxSize);
    if (!img) return null;
    let data = img.data;
    if (alphaMask) {
      // brilho próprio: a cor da textura vezes a máscara do canal alfa
      data = new Uint8Array(img.data.length);
      for (let i = 0; i < data.length; i += 4) {
        const a = img.data[i + 3] / 255;
        const k = a * a;
        data[i] = img.data[i] * k;
        data[i + 1] = img.data[i + 1] * k;
        data[i + 2] = img.data[i + 2] * k;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, img.width, img.height, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  })();
  texCache.set(key, job);
  return job;
}

/**
 * Material de uma textura do modelo: devolve na hora (cinza) e completa com as
 * texturas quando elas chegam. `dirs`: pastas onde o modelo procura (cdtextures).
 */
export function modelMaterial(read, name, dirs) {
  const key = `${dirs.join(',')}|${name}`;
  if (matCache.has(key)) return matCache.get(key);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.35, roughness: 0.5 });
  matCache.set(key, mat);
  (async () => {
    let vmt = null;
    for (const dir of dirs.length ? dirs : ['']) {
      const bytes = await read(`materials/${dir}${name}.vmt`);
      if (bytes) {
        vmt = parseVMT(new TextDecoder('latin1').decode(bytes));
        break;
      }
    }
    if (!vmt) return;
    const base = vmt.$basetexture ? texPath(vmt.$basetexture) : null;
    const additive = vmt.$additive === '1';
    const translucent = vmt.$translucent === '1' || additive;
    const selfillum = vmt.$selfillum === '1';
    const [map, emissiveMap, normalMap] = await Promise.all([
      base ? loadTexture(read, base) : null,
      base && selfillum ? loadTexture(read, base, { alphaMask: true }) : null,
      vmt.$bumpmap ? loadTexture(read, texPath(vmt.$bumpmap), { srgb: false }) : null,
    ]);
    if (map) {
      mat.map = map;
      mat.color.set(0xffffff);
    }
    if (emissiveMap) {
      mat.emissiveMap = emissiveMap;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 1.4;
    }
    if (normalMap) {
      mat.normalMap = normalMap;
      mat.normalScale.set(1, -1); // mapas do Source: verde invertido
    }
    if (vmt.$phong === '1') {
      mat.roughness = 0.38;
      mat.metalness = 0.45;
    }
    if (translucent) {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.opacity = additive ? 1 : 0.85;
      if (additive) mat.blending = THREE.AdditiveBlending;
    }
    if (vmt.$alphatest === '1') mat.alphaTest = 0.5;
    mat.needsUpdate = true;
  })().catch(() => {});
  return mat;
}

/**
 * Objeto 3D do modelo (coordenadas do Source). `skin`: família de pele.
 * Devolve { root, mixer, clips: Map(nome → clip), seqs: Map(nome → sequência) }.
 */
export function buildModel(model, read, { skin = 0, animated = true } = {}) {
  const root = new THREE.Group();
  const bones = model.bones.map((b, i) => {
    const o = new THREE.Bone();
    o.name = `b${i}`;
    o.position.fromArray(b.pos);
    o.quaternion.fromArray(b.quat);
    return o;
  });
  bones.forEach((o, i) => (model.bones[i].parent >= 0 ? bones[model.bones[i].parent].add(o) : root.add(o)));
  const inverses = model.bones.map((b) => {
    const m = b.poseToBone;
    return new THREE.Matrix4().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
  });
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones, inverses);
  const family = model.skins[skin] ?? model.skins[0] ?? [];
  for (const g of model.groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uvs, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(g.boneIdx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(g.boneW, 4));
    // o Source desenha a frente no sentido horário
    const idx = new Uint32Array(g.indices.length);
    for (let t = 0; t < g.indices.length; t += 3) idx.set([g.indices[t], g.indices[t + 2], g.indices[t + 1]], t);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const tex = model.textures[family[g.slot] ?? g.slot] ?? model.textures[g.slot] ?? '';
    const mat = modelMaterial(read, tex, model.dirs ?? []);
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.frustumCulled = false;
    if (mat.transparent) mesh.renderOrder = 5;
    root.add(mesh);
    mesh.bind(skeleton);
  }
  const clips = new Map();
  const seqs = new Map();
  if (animated)
    for (const s of model.sequences) {
      seqs.set(s.name, s);
      if (s.frames < 1) continue;
      const times = new Float32Array(s.frames).map((_, f) => f / s.fps);
      const tracks = [];
      model.bones.forEach((b, i) => {
        const q = new Float32Array(s.frames * 4);
        const p = new Float32Array(s.frames * 3);
        for (let f = 0; f < s.frames; f++) {
          q.set(s.rot[f][i], f * 4);
          p.set(s.pos[f][i], f * 3);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(`b${i}.quaternion`, times, q));
        tracks.push(new THREE.VectorKeyframeTrack(`b${i}.position`, times, p));
      });
      clips.set(s.name, new THREE.AnimationClip(s.name, s.frames > 1 ? (s.frames - 1) / s.fps : 0, tracks));
    }
  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, clips, seqs, bones, model };
}

/** container que leva o modelo (Source, polegadas) para o mundo daqui, na pose da entidade */
export function placeModel(obj, origin, f, u) {
  const left = new THREE.Vector3().crossVectors(u, f);
  const M = new THREE.Matrix4().makeBasis(f, u, left.clone().negate()).setPosition(origin);
  // Source (x, y, z) → daqui (x, z, −y), em metros
  const C = new THREE.Matrix4().set(S, 0, 0, 0, 0, 0, S, 0, 0, -S, 0, 0, 0, 0, 0, 1);
  const c = new THREE.Group();
  c.matrixAutoUpdate = false;
  c.matrix.copy(M).multiply(C);
  c.add(obj.root);
  return c;
}

/**
 * Toca uma sequência: `loop` repete; sem loop, para no último quadro (ou volta
 * para `then`, a animação padrão).
 */
export function playSeq(obj, name, { loop = null, then = null, fade = 0.2 } = {}) {
  const clip = obj.clips.get(name.toLowerCase());
  if (!clip) return false;
  const seq = obj.seqs.get(name.toLowerCase());
  const action = obj.mixer.clipAction(clip);
  const doLoop = loop ?? seq.loop;
  action.reset();
  action.setLoop(doLoop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  action.clampWhenFinished = true;
  if (obj.current && obj.current !== action) {
    action.play();
    obj.current.crossFadeTo(action, fade, false);
  } else action.play();
  obj.current = action;
  if (!doLoop && then) {
    const onDone = (e) => {
      if (e.action !== action) return;
      obj.mixer.removeEventListener('finished', onDone);
      playSeq(obj, then, { loop: true });
    };
    obj.mixer.addEventListener('finished', onDone);
  }
  return true;
}
