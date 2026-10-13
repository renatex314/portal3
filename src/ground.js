// Cena "superfície": um deserto com o buraco que atravessa a Terra, uma
// exploradora na borda e a placa — a imagem que inspirou o projeto, em 3D.
// Escala: 1 unidade = 1 metro.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, noise2, rand } from './noise.js';

export const HOLE_R = 7;
export const HOLE_DEPTH = 220;

function holeRadiusAt(angle) {
  // borda irregular, igual em cima e nas paredes (sem frestas)
  const n = noise2(Math.cos(angle) * 2.2 + 5, Math.sin(angle) * 2.2 + 5);
  return HOLE_R * (0.9 + 0.22 * n);
}

function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = (fbm2(x * 0.02, z * 0.02) - 0.5) * 3.0 + (noise2(x * 0.15, z * 0.15) - 0.5) * 0.35;
  // mesas (morros de topo achatado) no horizonte
  const m = fbm2(x * 0.0035 + 3.3, z * 0.0035 - 1.7, 4);
  const far = THREE.MathUtils.smoothstep(d, 420, 800);
  const mesa = THREE.MathUtils.smoothstep(m, 0.53, 0.56);
  const step2 = THREE.MathUtils.smoothstep(m, 0.6, 0.62);
  h += (mesa * 38 + step2 * 22) * far;
  // monte de entulho em volta do buraco
  h += 1.1 * Math.exp(-((d - HOLE_R * 1.9) ** 2) / 10);
  // achata perto do buraco
  h *= THREE.MathUtils.smoothstep(d, HOLE_R * 0.95, HOLE_R * 1.3) * 0.9 + 0.1;
  return h;
}

export class GroundScene {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xd9c2a0, 120, 1500);
    this.renderer = renderer;
    this._sky();
    this._lights();
    this._terrain();
    this._hole();
    this._props();
    this._person();
    this._sign();
    this._dust();
  }

  _sky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0.55, 0.62, -0.55).normalize() } },
      vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; varying vec3 vD;
        void main(){
          float h = max(vD.y, 0.0);
          vec3 zen = vec3(0.08, 0.28, 0.70);
          vec3 hor = vec3(0.78, 0.80, 0.82);
          vec3 c = mix(hor, zen, pow(h, 0.3));
          float s = max(dot(vD, uSun), 0.0);
          c += vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.35 + vec3(1.0, 0.95, 0.85) * pow(s, 900.0) * 6.0;
          if (vD.y < 0.0) c = hor * 0.9;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
    this.scene.add(sky);
    this.sunDir = mat.uniforms.uSun.value;
  }

  _lights() {
    const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
    sun.position.copy(this.sunDir).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = c.bottom = -30;
    c.right = c.top = 30;
    c.near = 1;
    c.far = 200;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0x9cc4ff, 0x8a5a3a, 0.9));
  }

  _terrain() {
    // malha polar: densa perto do buraco, esparsa no horizonte
    const nA = 220;
    const nR = 170;
    const Rmax = 1600;
    const pos = [];
    const col = [];
    const idx = [];
    const c = new THREE.Color();
    const sand = new THREE.Color(0xc79766);
    const sand2 = new THREE.Color(0xb27a4f);
    const rock = new THREE.Color(0xa4552e);
    const rockDark = new THREE.Color(0x7c3c22);
    for (let i = 0; i <= nR; i++) {
      const t = i / nR;
      for (let j = 0; j < nA; j++) {
        const a = (j / nA) * Math.PI * 2;
        const r0 = holeRadiusAt(a);
        const r = r0 + (Rmax - r0) * Math.pow(t, 2.4);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const y = i === 0 ? 0 : terrainHeight(x, z);
        pos.push(x, y, z);
        // cor: areia embaixo, rocha listrada nas mesas
        const n = fbm2(x * 0.05, z * 0.05, 3);
        c.copy(sand).lerp(sand2, n);
        if (y > 4) {
          const band = 0.5 + 0.5 * Math.sin(y * 0.55 + n * 3);
          c.copy(rock).lerp(rockDark, band * 0.7);
        }
        if (r < HOLE_R * 2.4) c.lerp(new THREE.Color(0x9d6a45), 0.45 * (1 - (r - r0) / (HOLE_R * 1.6)));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < nR; i++) {
      for (let j = 0; j < nA; j++) {
        const a = i * nA + j;
        const b = i * nA + ((j + 1) % nA);
        const c2 = (i + 1) * nA + j;
        const d = (i + 1) * nA + ((j + 1) % nA);
        idx.push(a, b, c2, b, d, c2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  _hole() {
    // paredes do buraco: estratos de rocha que escurecem com a profundidade
    const nA = 220;
    const nD = 160;
    const pos = [];
    const col = [];
    const idx = [];
    const c = new THREE.Color();
    const strata = [0xc58a5a, 0xa8613a, 0xd6a274, 0x8e4c2c, 0xb87a4e, 0x7a4430, 0xc49a70].map((h) => new THREE.Color(h));
    for (let i = 0; i <= nD; i++) {
      const depth = Math.pow(i / nD, 1.6) * HOLE_DEPTH;
      for (let j = 0; j <= nA; j++) {
        const a = (j / nA) * Math.PI * 2;
        let r = holeRadiusAt(a);
        // saliências e plataformas
        const ledge = Math.sin(depth * 0.9 + noise2(a * 3, depth * 0.2) * 3) * 0.18 + (noise2(a * 6, depth * 0.6) - 0.5) * 0.5;
        r *= 1 + (i === 0 ? 0 : ledge * 0.08 + depth * 0.0004);
        pos.push(Math.cos(a) * r, -depth, Math.sin(a) * r);
        const bf = depth * 0.7 + noise2(a * 2, depth * 0.3) * 2;
        const bi = Math.floor(bf);
        const ff = THREE.MathUtils.smoothstep(bf - bi, 0.35, 0.65);
        c.copy(strata[bi % strata.length]).lerp(strata[(bi + 1) % strata.length], ff);
        const dark = Math.exp(-depth / 5.5);
        c.multiplyScalar(0.015 + 0.985 * dark);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < nD; i++) {
      for (let j = 0; j < nA; j++) {
        const a = i * (nA + 1) + j;
        const b = a + 1;
        const c2 = a + nA + 1;
        const d = c2 + 1;
        idx.push(a, b, c2, b, d, c2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    const wall = new THREE.Mesh(geo, mat);
    wall.receiveShadow = true;
    this.scene.add(wall);

    // fundo negro (escuridão total)
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R * 2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    bottom.position.y = -HOLE_DEPTH + 1;
    this.scene.add(bottom);
  }

  _props() {
    // cactos (saguaro): tronco + braços
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.32, 0.38, 4.2, 10).translate(0, 2.1, 0);
    const armL = new THREE.CylinderGeometry(0.22, 0.24, 1.6, 8).translate(-0.75, 2.6, 0);
    const armLb = new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).rotateZ(Math.PI / 2).translate(-0.45, 1.85, 0);
    const armR = new THREE.CylinderGeometry(0.2, 0.22, 1.2, 8).translate(0.7, 2.9, 0);
    const armRb = new THREE.CylinderGeometry(0.2, 0.2, 0.55, 8).rotateZ(Math.PI / 2).translate(0.42, 2.35, 0);
    parts.push(trunk, armL, armLb, armR, armRb, new THREE.SphereGeometry(0.32, 10, 6).translate(0, 4.2, 0));
    const cactusGeo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f6b35, roughness: 0.8 });
    const nC = 70;
    const cacti = new THREE.InstancedMesh(cactusGeo, cactusMat, nC);
    const bushGeo = new THREE.IcosahedronGeometry(0.7, 1).scale(1.3, 0.6, 1.3);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x8a8a4a, roughness: 1 });
    const nB = 260;
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, nB);
    const rockGeo = new THREE.DodecahedronGeometry(0.5, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a5c3a, roughness: 1 });
    const nRk = 140;
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, nRk);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const place = (inst, n, rMin, rMax, scl, exclude) => {
      let k = 0;
      while (k < n) {
        const a = rand() * Math.PI * 2;
        const r = rMin + Math.pow(rand(), 1.5) * (rMax - rMin);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (exclude && exclude(x, z)) continue;
        p.set(x, terrainHeight(x, z) - 0.1, z);
        q.setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0));
        const sc = scl[0] + rand() * (scl[1] - scl[0]);
        s.set(sc, sc * (0.8 + rand() * 0.5), sc);
        m.compose(p, q, s);
        inst.setMatrixAt(k++, m);
      }
      inst.castShadow = true;
      inst.receiveShadow = true;
      this.scene.add(inst);
    };
    // deixa livre o lado da câmera/placa
    const keepClear = (x, z) => x > 2 && x < 40 && z > -6 && z < 40;
    place(cacti, nC, 18, 260, [0.8, 1.5], keepClear);
    place(bushes, nB, 10, 220, [0.4, 1.3], keepClear);
    place(rocks, nRk, HOLE_R * 1.05, HOLE_R * 2.6, [0.15, 0.7], (x, z) => x > 7.5 && x < 11.5 && z > -5 && z < 6);
  }

  _person() {
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc58c64, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x6f6a4c, roughness: 0.9 });
    const shorts = new THREE.MeshStandardMaterial({ color: 0x8b7d5c, roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.8 });
    const hatM = new THREE.MeshStandardMaterial({ color: 0x8c8466, roughness: 0.9 });
    const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    add(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), skin, -0.11, 0.38, 0); // pernas
    add(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), skin, 0.11, 0.38, 0.03);
    add(new THREE.BoxGeometry(0.16, 0.14, 0.26), boots, -0.11, 0.07, 0.04);
    add(new THREE.BoxGeometry(0.16, 0.14, 0.26), boots, 0.11, 0.07, 0.07);
    add(new THREE.CylinderGeometry(0.2, 0.18, 0.28, 14), shorts, 0, 0.8, 0);
    add(new THREE.CapsuleGeometry(0.18, 0.36, 6, 14), shirt, 0, 1.15, 0);
    add(new THREE.BoxGeometry(0.3, 0.42, 0.14), shirt, 0, 1.18, -0.2); // mochila
    add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), skin, -0.27, 1.06, 0.08, 0.35, 0.12); // braços
    add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), skin, 0.27, 1.06, 0.08, 0.35, -0.12);
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 1.43, 0); // pescoço
    add(new THREE.SphereGeometry(0.12, 16, 12), skin, 0, 1.56, 0.02, -0.5, 0); // cabeça
    add(new THREE.CylinderGeometry(0.29, 0.29, 0.02, 24), hatM, 0, 1.64, 0.04, -0.45, 0); // aba
    add(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 16), hatM, 0, 1.7, 0.02, -0.45, 0);
    // olhando para dentro do buraco
    const px = 8.7;
    const pz = -3.4;
    g.position.set(px, terrainHeight(px, pz) - 0.05, pz);
    g.rotation.y = Math.atan2(-px, -pz); // de frente para o centro do buraco
    g.rotation.x = 0.06;
    g.scale.setScalar(1.05);
    this.person = g;
    this.scene.add(g);
  }

  _sign() {
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = 420;
    const x = cv.getContext('2d');
    // madeira
    const grd = x.createLinearGradient(0, 0, 0, cv.height);
    grd.addColorStop(0, '#b48a5e');
    grd.addColorStop(1, '#94693f');
    x.fillStyle = grd;
    x.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 70; i++) {
      x.strokeStyle = `rgba(70,40,15,${0.08 + Math.random() * 0.12})`;
      x.lineWidth = 1 + Math.random() * 3;
      x.beginPath();
      const yy = Math.random() * cv.height;
      x.moveTo(0, yy);
      x.bezierCurveTo(300, yy + Math.random() * 20 - 10, 700, yy + Math.random() * 20 - 10, cv.width, yy);
      x.stroke();
    }
    x.fillStyle = '#2a1a0e';
    x.textAlign = 'center';
    x.font = 'bold 84px "Arial Black", Impact, sans-serif';
    x.fillText('TÚNEL ATÉ A CHINA', cv.width / 2, 150);
    x.font = 'bold 38px Arial, sans-serif';
    x.fillText('PROFUNDIDADE: 12.742 km', cv.width / 2, 240);
    x.font = 'italic 34px Georgia, serif';
    x.fillText('(spoiler: não é bem a China...)', cv.width / 2, 320);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9 });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), wood);
    post.position.y = 1.3;
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.07, 0.08), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), wood]);
    board.position.set(0, 2.05, 0.12);
    board.rotation.z = -0.03;
    post.castShadow = board.castShadow = true;
    g.add(post, board);
    g.position.set(HOLE_R * 1.55, terrainHeight(HOLE_R * 1.55, 4.2), 4.2);
    g.rotation.y = 0.35;
    this.scene.add(g);
    this.sign = g;
  }

  _dust() {
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rand() - 0.5) * 120;
      pos[i * 3 + 1] = rand() * 12;
      pos[i * 3 + 2] = (rand() - 0.5) * 120;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xf0d8b0, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.scene.add(this.dust);
  }

  update(t) {
    this.dust.position.x = Math.sin(t * 0.1) * 3 + ((t * 1.2) % 30) - 15;
    this.dust.position.z = Math.cos(t * 0.13) * 2;
  }
}
