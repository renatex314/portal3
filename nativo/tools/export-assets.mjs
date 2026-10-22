// Exporta do jogo web (rodando no Vite) o que a versão nativa carrega pronto:
//  - texturas procedurais (canvas) → assets/textures/*.png  + manifest.json (repetição)
//  - mapa de ambiente (RoomEnvironment) → assets/textures/env.hdr (6 faces empilhadas)
//  - modelos do models.js / mine.js / dinos.js → assets/models/*.glb
//    (as peças animadas ganham nome pelo caminho no userData; materiais que o glTF não
//    representa — básicos com cor acima de 1, shaders — vão em "extras" para o Rust refazer)
//
// Uso (com o Vite rodando em 127.0.0.1:5317):
//   NODE_PATH=<pasta com puppeteer-core> node nativo/tools/export-assets.mjs

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../assets');
mkdirSync(resolve(out, 'textures'), { recursive: true });
mkdirSync(resolve(out, 'models'), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERRO na página:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 300)));
await page.goto('http://127.0.0.1:5317/jogo.html?debug', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1500));

// ------------------------------------------------------------------ texturas (não com ONLY: o ruído delas muda a cada vez)
if (!process.env.ONLY) {
const tex = await page.evaluate(async () => {
  const TX = await import('/src/game/textures.js');
  const png = (t) => (t?.image?.toDataURL ? t.image.toDataURL('image/png') : null);
  const out = {};
  for (const name of ['whiteWall', 'whiteFloor', 'metalWall', 'metalFloor', 'ceiling', 'rock', 'doorPanel', 'moonGround']) {
    const r = TX[name]();
    out[name] = { map: png(r.map), normal: png(r.normalMap), rough: png(r.roughnessMap), repeat: r.map?.repeat?.x ?? 1 };
  }
  const hs = TX.hazardStripe();
  out.hazardStripe = { map: png(hs), repeat: hs.repeat?.x ?? 1 };
  return out;
});
const manifest = {};
for (const [name, t] of Object.entries(tex)) {
  manifest[name] = { repeat: t.repeat };
  for (const k of ['map', 'normal', 'rough']) {
    if (!t[k]) continue;
    writeFileSync(resolve(out, 'textures', `${name}_${k}.png`), Buffer.from(t[k].split(',')[1], 'base64'));
    manifest[name][k] = `textures/${name}_${k}.png`;
  }
}
writeFileSync(resolve(out, 'textures/manifest.json'), JSON.stringify(manifest, null, 1));
console.log('texturas:', Object.keys(manifest).join(', '));

// ------------------------------------------------------------------ mapa de ambiente
const env = await page.evaluate(async () => {
  const THREE = window.__jogo.THREE;
  const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js');
  const renderer = new THREE.WebGLRenderer();
  const size = 256;
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.FloatType });
  const cam = new THREE.CubeCamera(0.1, 100, rt);
  cam.update(renderer, new RoomEnvironment());
  // faces na ordem do cubemap: +x −x +y −y +z −z
  const faces = [];
  const buf = new Float32Array(size * size * 4);
  for (let f = 0; f < 6; f++) {
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, f);
    faces.push(Array.from(buf));
  }
  return { size, faces };
});
// Radiance .hdr (RGBE, sem compressão RLE), faces empilhadas na vertical
{
  const { size, faces } = env;
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${size * 6} +X ${size}\n`, 'ascii');
  const px = Buffer.alloc(size * size * 6 * 4);
  let o = 0;
  for (let f = 0; f < 6; f++)
    for (let y = size - 1; y >= 0; y--) // o readPixels vem de baixo para cima
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const [r, g, b] = [faces[f][i], faces[f][i + 1], faces[f][i + 2]];
        const m = Math.max(r, g, b);
        if (m < 1e-32) {
          px.writeUInt32BE(0, o);
        } else {
          const e = Math.ceil(Math.log2(m));
          const s = 256 / 2 ** e;
          px[o] = Math.min(255, Math.floor(r * s));
          px[o + 1] = Math.min(255, Math.floor(g * s));
          px[o + 2] = Math.min(255, Math.floor(b * s));
          px[o + 3] = e + 128;
        }
        o += 4;
      }
  writeFileSync(resolve(out, 'textures/env.hdr'), Buffer.concat([header, px]));
  console.log('ambiente: textures/env.hdr', size, 'x', size * 6);
}
}

// ------------------------------------------------------------------ modelos
// ONLY=nome1,nome2: só esses modelos
const models = await page.evaluate(async (only) => {
  const THREE = window.__jogo.THREE;
  const { mergeGeometries } = await import('/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js');
  const M = await import('/src/game/models.js');
  const T = await import('/src/game/turrets.js');
  const MINE = await import('/src/mine.js');
  const D = await import('/src/dinos.js');
  const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');

  /** dá nome às peças guardadas no userData (o Rust as acha pelo nome) */
  function nameRefs(data, prefix, seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return;
    seen.add(data);
    for (const [k, v] of Object.entries(data)) {
      const key = prefix ? `${prefix}_${k}` : k;
      if (v?.isObject3D) {
        if (!v.name) v.name = key;
      } else if (v?.isMaterial) {
        if (!v.name) v.name = key; // materiais animados (o Rust dá uma cópia a cada instância)
      } else if (Array.isArray(v)) v.forEach((x, i) => (x?.isObject3D || x?.isMaterial ? x.name || (x.name = `${key}_${i}`) : nameRefs(x, `${key}_${i}`, seen)));
      else if (v && typeof v === 'object' && !v.isMaterial && !v.isTexture && !v.isColor && !v.isVector3) nameRefs(v, key, seen);
    }
  }
  /** materiais que o glTF não guarda direito: vão em extras, e o Rust refaz */
  function annotate(root) {
    root.traverse((o) => {
      if (o.userData) {
        // o glTF copia o userData para "extras": tira o que não é JSON
        const keep = {};
        for (const [k, v] of Object.entries(o.userData)) if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') keep[k] = v;
        o.userData = keep;
      }
      const mats = [o.material].flat().filter(Boolean);
      for (const m of mats) {
        const info = {};
        if (m.isMeshBasicMaterial) Object.assign(info, { basic: true, color: [m.color.r, m.color.g, m.color.b], toneMapped: m.toneMapped !== false });
        if (m.isShaderMaterial) info.shader = m.name || m.fragmentShader?.slice(0, 80) || 'shader';
        if (m.transparent) Object.assign(info, { transparent: true, opacity: m.opacity, additive: m.blending === THREE.AdditiveBlending, depthWrite: m.depthWrite });
        if (m.emissive && m.emissiveIntensity !== 1) info.emissiveIntensity = m.emissiveIntensity;
        if (m.side === THREE.DoubleSide) info.doubleSide = true;
        if (Object.keys(info).length) {
          o.userData.mat = o.userData.mat ?? info;
          if (m.isShaderMaterial) o.material = new THREE.MeshBasicMaterial({ color: 0xff00ff, name: 'shader' });
        }
      }
    });
  }
  /**
   * Marca as peças que o glTF perde ou que o Rust anima sem referência no userData:
   * shaders conhecidos (pelos uniforms), sprites (viram nós vazios com o brilho nos extras),
   * pontos, linhas e alguns materiais (cobre, brilho interno, painel holográfico).
   */
  function tagParts(root) {
    const sprites = [];
    let rods = 0;
    let clocks = 0;
    root.traverse((o) => {
      const m = o.material;
      if (m?.isShaderMaterial && !m.name) {
        const u = m.uniforms ?? {};
        m.name = u.uPulse ? 'conduit' : u.uBoost ? 'plasma' : u.uSpread ? 'motes' : '';
      }
      if (o.isPoints && !o.name) o.name = 'points';
      if (o.isLineSegments && !o.name && m?.blending === THREE.AdditiveBlending) o.name = 'arcs';
      if (o.userData?.base?.isVector3 && !o.name) o.name = `rod_${rods++}`;
      if (o.isMesh && typeof o.userData?.dir === 'number' && m?.map && !o.name) o.name = `clock_${clocks++}`;
      if (m && !Array.isArray(m) && !m.name) {
        if (m.color && m.metalness > 0.8 && m.color.getHex() === 0x7a4024) m.name = 'copper';
        else if (m.isMeshBasicMaterial && m.side === THREE.BackSide) m.name = 'innerGlow';
        else if (m.map && m.alphaTest > 0 && o.isMesh && !o.name) o.name = 'holo';
      }
      if (o.isSprite) sprites.push(o);
    });
    // sprites: nós vazios no mesmo lugar, com cor, escala e tipo de brilho nos extras
    sprites.forEach((sp, i) => {
      const e = new THREE.Object3D();
      e.name = sp.name || `sprite_${i}`;
      e.position.copy(sp.position);
      const sm = sp.material;
      Object.assign(e.userData, {
        sprite: 1,
        sx: sp.scale.x,
        sy: sp.scale.y,
        k: typeof sp.userData.k === 'number' ? sp.userData.k : 1,
        cr: sm.color.r,
        cg: sm.color.g,
        cb: sm.color.b,
        opacity: sm.opacity,
        additive: sm.blending === THREE.AdditiveBlending,
      });
      sp.parent.add(e);
      sp.parent.remove(sp);
    });
  }
  const exporter = new GLTFExporter();
  const glb = (obj) =>
    new Promise((res, rej) =>
      exporter.parse(obj, (b) => res(btoa(Array.from(new Uint8Array(b), (c) => String.fromCharCode(c)).join(''))), rej, { binary: true, onlyVisible: false }),
    );
  const job = async (name, make) => {
    try {
      const obj = make();
      const root = obj.isObject3D ? obj : obj.group;
      nameRefs(root.userData, '');
      nameRefs(obj.isObject3D ? {} : obj, '');
      tagParts(root);
      annotate(root);
      return [name, await glb(root)];
    } catch (e) {
      return [name, null, String(e)];
    }
  };
  const jobs = [
    ['gun', () => M.portalGun()],
    ['gun_classic', () => M.portalGunClassic()],
    ['cube', () => M.sampleCube()],
    ['cube_laser', () => M.sampleCube({ laser: true })],
    ['cube_special', () => M.sampleCube({ special: true })],
    ['floor_button', () => M.floorButton()],
    ['turret', () => M.turretModel()],
    ['crystal', () => T.crystalMesh()],
  ];
  // botões: as cores de luz acesa/apagada e a tampa vão nos extras da raiz
  const pb = (wall, look) => () => {
    const m = M.pushButtonModel(wall, look);
    const u = m.group.userData;
    u.onR = m.onMat.color.r;
    u.onG = m.onMat.color.g;
    u.onB = m.onMat.color.b;
    u.off = m.offMat.color.getHex();
    u.capEm = m.capMat?.emissive?.getHex() ?? 0;
    u.capEmK = m.capMat?.emissiveIntensity ?? 1;
    return m;
  };
  for (const [look] of M.PUSH_LOOKS) {
    jobs.push([`push_${look}`, pb(false, look)]);
    jobs.push([`push_${look}_wall`, pb(true, look)]);
  }
  // dinossauros: o esqueleto já tem nomes (dino_*); os números da animação vão nos extras da raiz
  const dino = (s, o = {}) => () => {
    const d = D.makeDino(s, o);
    const u = d.group.userData;
    for (const k of ['hipH', 'bob', 'cycle', 'walkSpeed', 'tailStiff', 'neckRest', 'headRest', 'height']) if (typeof d[k] === 'number') u[k] = d[k];
    u.species = s;
    d.legs.forEach((L, i) => Object.assign(u, { [`leg${i}_offset`]: L.offset, [`leg${i}_amp`]: L.amp, [`leg${i}_rest1`]: L.rest1, [`leg${i}_rest2`]: L.rest2 }));
    u.legs = d.legs.length;
    u.tail = d.tail.length;
    u.neck = d.neck.length;
    (d.arms ?? []).forEach((a, i) => (u[`arm${i}_side`] = a.side));
    u.arms = (d.arms ?? []).length;
    d.wings.forEach((w, i) => (u[`wing${i}_side`] = w.side));
    u.wings = d.wings.length;
    return d;
  };
  const hex = (c) => c.toString(16).padStart(6, '0');
  for (const s of ['rex', 'raptor', 'titan', 'trice', 'stego', 'ptero']) jobs.push([`dino_${s}`, dino(s)]);
  // variantes usadas nas fases (capacete, colete) e o corpo do jogador (raptor de capacete branco e colete laranja)
  for (const [s, o] of [
    ['rex', { helmet: 0xf2c000 }],
    ['raptor', { helmet: 0xffffff }],
    ['raptor', { helmet: 0xff7a1a }],
    ['raptor', { helmet: 0xf2c200 }],
    ['raptor', { helmet: 0xffffff, vest: 0xe8762a }],
    ['raptor', { helmet: 0x8fe3ff, vest: 0x38d8ff }], // o clone do relógio (em tons de cinza no jogo)
  ])
    jobs.push([`dino_${s}${o.helmet !== undefined ? `_h${hex(o.helmet)}` : ''}${o.vest !== undefined ? `_v${hex(o.vest)}` : ''}`, dino(s, o)]);
  // os outros jogadores (multiplayer): capacete branco, colete da cor dos portais da vaga, corpo de cada vaga
  {
    const P = await import('/src/game/portals.js');
    const body = [0x8a5a34, 0x5e7a3a, 0x6a5a8a, 0x9a7a3a];
    for (let i = 0; i < 4; i++) jobs.push([`dino_avatar_${i}`, dino('raptor', { helmet: 0xffffff, vest: P.SLOT_COLORS[i][0].getHex(), color: body[i] })]);
  }
  // pessoas das cabines (documentary.js: aparência e pose de cada uma)
  const DOC = await import('/src/documentary.js');
  const MINE2 = MINE;
  for (const [id, p] of Object.entries(DOC.PEOPLE))
    jobs.push([
      `worker_${id}`,
      () => {
        const w = MINE2.makeWorker(p.look, p.pose);
        w.group.userData.pose = p.pose;
        return w;
      },
    ]);
  jobs.push(['fossil', () => D.makeFossil()]);
  // chefe B01: o salão montado pela própria fase (crânio, veias, cenário); só os visuais
  const CH = await import('/src/game/chefe.js');
  const BS = await import('/src/game/campaign/boss.js');
  jobs.push([
    'boss',
    () => {
      const noop = new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : noop), apply: () => noop, set: () => true });
      const group = new THREE.Group();
      const w = new Proxy({}, { get: (_, k) => (k === 'group' ? group : k === 'anim' ? [] : k === 'then' ? undefined : () => noop) });
      CH.CHEFES[0].build(w);
      group.traverse((o) => {
        // veias: o centro do tubo e a semente de fase vão na cor do vértice (xyz = centro, w = semente)
        if (o.name?.startsWith('vein_')) {
          const g = o.geometry;
          const c = g.attributes.aCenter;
          const s = g.attributes.aSeed;
          const col = new Float32Array(c.count * 4);
          for (let i = 0; i < c.count; i++) col.set([c.getX(i), c.getY(i), c.getZ(i), s.getX(i)], i * 4);
          g.deleteAttribute('aCenter');
          g.deleteAttribute('aSeed');
          g.setAttribute('color', new THREE.BufferAttribute(col, 4));
          const u = o.material.uniforms;
          Object.assign(o.userData, { vein: 1, amp: u.uAmp.value, cr: u.uColor.value.r, cg: u.uColor.value.g, cb: u.uColor.value.b, calm: o.name.startsWith('vein_calm') ? 1 : 0 });
          o.material = new THREE.MeshBasicMaterial({ name: 'vein' });
        }
        if (o.name?.startsWith('strap_')) o.visible = true;
      });
      // LEDs (InstancedMesh): uma malha só, com a cor de cada LED nos vértices
      const leds = group.getObjectByName('leds');
      if (leds) {
        const parts = [];
        const m4 = new THREE.Matrix4();
        const pal = [[0.2, 2.4, 0.5], [2.6, 0.5, 0.2], [0.3, 0.9, 2.6], [0.02, 0.02, 0.02]];
        for (let i = 0; i < leds.count; i++) {
          leds.getMatrixAt(i, m4);
          const g = leds.geometry.clone().applyMatrix4(m4).toNonIndexed();
          const c = pal[Math.floor(Math.random() * 4)];
          const col = new Float32Array(g.attributes.position.count * 4);
          for (let k = 0; k < g.attributes.position.count; k++) col.set([...c, 1], k * 4);
          g.setAttribute('color', new THREE.BufferAttribute(col, 4));
          parts.push(g);
        }
        const merged = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ name: 'leds', toneMapped: false }));
        merged.name = 'leds';
        merged.userData.n = leds.count;
        merged.userData.per = parts[0].attributes.position.count;
        leds.parent.add(merged);
        leds.parent.remove(leds);
      }
      return group;
    },
  ]);
  jobs.push(['rocket_turret', () => new BS.RocketTurret(new THREE.Group(), new THREE.Vector3(), false)]);
  jobs.push([
    'rocket',
    () => {
      const r = new BS.Rocket(new THREE.Group(), new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
      r.mesh.position.set(0, 0, 0);
      r.mesh.rotation.set(0, 0, 0);
      r.spin.name = 'spin';
      r.flame.name = 'flame';
      return r.mesh;
    },
  ]);
  for (let i = 0; i < 3; i++) jobs.push([`core_${i}`, () => BS.coreModel(i)]);
  const results = [];
  for (const [name, make] of jobs) if (!only || only.split(',').includes(name)) results.push(await job(name, make));
  return results;
}, process.env.ONLY ?? '');
for (const [name, data, err] of models) {
  if (!data) {
    console.log(`modelo ${name}: FALHOU ${err}`);
    continue;
  }
  writeFileSync(resolve(out, 'models', `${name}.glb`), Buffer.from(data, 'base64'));
  console.log(`modelo ${name}: ${Math.round(data.length * 0.75 / 1024)} KB`);
}
await browser.close();
