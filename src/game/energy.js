// Bolas de energia: saem do lançador em linha reta, quicam nas superfícies,
// atravessam portais (conservando a velocidade) e, se entrarem no receptor,
// ligam o sinal dele (abre porta, liga elevador). Encostar mata. Depois de um
// tempo a bola se desfaz e o lançador solta outra.

import * as THREE from 'three';
import { PORTAL_A, PORTAL_B } from './portals.js';

const R = 0.16;
const TRAIL = 14;
const LIGHTS = 4; // bolas com luz própria ao mesmo tempo

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,240,200,1)');
  gr.addColorStop(0.3, 'rgba(255,170,60,0.8)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

export class EnergySystem {
  constructor(scene) {
    this.scene = scene;
    this.pellets = [];
    this.glow = glowTexture();
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.0) });
    this.coreGeo = new THREE.SphereGeometry(R, 20, 14);
    this.shellGeo = new THREE.IcosahedronGeometry(R * 1.45, 1);
    this.shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.2, 0.3), wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trailMat = new THREE.ShaderMaterial({
      uniforms: { uH: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float k; uniform float uH; varying float vK;
        void main(){
          vK = k;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = ${(R * 2.2).toFixed(3)} * k * projectionMatrix[1][1] * uH / max(-mv.z, 0.05);
        }`,
      fragmentShader: /* glsl */ `
        varying float vK;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          gl_FragColor = vec4(vec3(2.6, 1.3, 0.4) * vK, vK * vK * (1.0 - d * d));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // luzes reservadas (sempre na cena, apagadas quando livres): criar e tirar
    // luzes muda o número de luzes da cena e força recompilar todos os materiais
    this.lights = Array.from({ length: LIGHTS }, () => {
      const l = new THREE.PointLight(0xffa040, 0, 6, 1.6);
      scene.add(l);
      return l;
    });
    // bola-modelo invisível: só para os shaders dela serem compilados ao carregar a fase
    const ghost = this.build();
    ghost.group.visible = false;
    ghost.trail.visible = false;
    scene.add(ghost.group, ghost.trail);
  }

  /** malhas de uma bola (núcleo, casca, brilho) e do rastro */
  build() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.coreGeo, this.coreMat));
    const shell = new THREE.Mesh(this.shellGeo, this.shellMat);
    g.add(shell);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.setScalar(1.3);
    g.add(sp);
    const trail = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3)),
      this.trailMat,
    );
    trail.geometry.setAttribute('k', new THREE.BufferAttribute(Float32Array.from({ length: TRAIL }, (_, i) => 1 - i / TRAIL), 1));
    trail.frustumCulled = false;
    return { group: g, shell, sprite: sp, trail };
  }

  reset() {
    for (const p of this.pellets) this.scene.remove(p.group, p.trail);
    for (const l of this.lights) {
      l.userData.busy = false;
      l.intensity = 0;
    }
    this.pellets = [];
  }

  spawn(L) {
    // casca de plasma girando em volta do núcleo; rastro com as últimas posições
    const { group: g, shell, sprite: sp, trail } = this.build();
    g.position.copy(L.pos);
    this.scene.add(g, trail);
    const light = this.lights.find((l) => !l.userData.busy) ?? null;
    if (light) {
      light.userData.busy = true;
      light.intensity = 6;
    }
    const hist = Array.from({ length: TRAIL }, () => L.pos.clone());
    const p = { pos: L.pos.clone(), vel: L.dir.clone().multiplyScalar(L.speed), life: L.life, from: L, group: g, sprite: sp, shell, trail, hist, light, cooldown: 0 };
    L.pellet = p;
    this.pellets.push(p);
    return p;
  }

  kill(p) {
    this.scene.remove(p.group, p.trail);
    if (p.light) {
      p.light.userData.busy = false;
      p.light.intensity = 0;
    }
    p.trail.geometry.dispose();
    this.pellets = this.pellets.filter((q) => q !== p);
    if (p.from.pellet === p) {
      p.from.pellet = null;
      p.from.wait = 1.6;
    }
  }

  /**
   * avança as bolas; `player` = { min, max } do corpo. Eventos em `on`:
   * bounce(pos), caught(catcher), pop(pos), hitPlayer()
   */
  update(dt, t, world, portals, player, on = {}) {
    for (const L of world.launchers) {
      L.group.userData.glow.color.setRGB(2.6, 1.4 + Math.sin(t * 6) * 0.3, 0.5);
      if (L.done || L.pellet) continue;
      L.wait -= dt;
      if (L.wait <= 0) {
        this.spawn(L);
        on.launch?.(L.pos);
      }
    }
    for (const C of world.catchers) {
      const k = C.active ? 2.4 : 0.9 + Math.sin(t * 3) * 0.2;
      C.group.userData.glow.color.setRGB(0.5 * k, 1.2 * k, 1.8 * k);
      C.group.userData.spin.rotation.y += dt * (C.active ? 6 : 0.8);
    }
    for (const L of world.launchers) L.group.userData.spin.rotation.y -= dt * (L.pellet ? 1.5 : 0.4 + Math.max(0, 2 - L.wait) * 3);
    for (const p of [...this.pellets]) {
      p.life -= dt;
      p.cooldown -= dt;
      // passos curtos: a bola nunca atravessa uma parede fina
      let rest = p.vel.length() * dt;
      while (rest > 1e-4) {
        const step = Math.min(rest, 0.12);
        rest -= step;
        const dir = p.vel.clone().normalize();
        const next = p.pos.clone().addScaledVector(dir, step);
        const P = p.cooldown <= 0 ? portals.crossing(p.pos, next) : null;
        if (P) {
          p.pos.copy(next);
          portals.carry(P, p.pos, p.vel);
          p.cooldown = 0.1;
          continue;
        }
        const hit = world.raycast(p.pos, dir, step + R);
        // bateu onde há um portal ligado: não quica, segue até cruzar o plano dele
        const intoPortal =
          hit &&
          portals.list.some((Q) => {
            if (!portals.isLinked(Q) || Q.box !== hit.box) return false;
            const l = Q.local(hit.point);
            return (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 1;
          });
        if (hit && !intoPortal) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, R + 0.002);
          p.vel.addScaledVector(hit.normal, -2 * p.vel.dot(hit.normal));
          on.bounce?.(p.pos);
          continue;
        }
        p.pos.copy(next);
      }
      p.group.position.copy(p.pos);
      p.light?.position.copy(p.pos);
      p.shell.rotation.set(t * 3.1, t * 4.3, t * 2.2);
      // rastro (pula a amostra quando a bola atravessa um portal)
      if (p.hist[0].distanceTo(p.pos) > 1.5) for (const h of p.hist) h.copy(p.pos);
      p.hist.pop();
      p.hist.unshift(p.pos.clone());
      const tp = p.trail.geometry.attributes.position;
      p.hist.forEach((h, i) => tp.setXYZ(i, h.x, h.y, h.z));
      tp.needsUpdate = true;
      this.trailMat.uniforms.uH.value = window.innerHeight * 0.75;
      p.sprite.material.rotation = t * 3;
      p.sprite.scale.setScalar(1.2 + Math.sin(t * 25) * 0.12);
      // receptor
      const C = world.catchers.find((c) => !c.active && c.pos.distanceTo(p.pos) < 0.55);
      if (C) {
        C.active = true;
        p.from.done = true;
        this.kill(p);
        on.caught?.(C);
        continue;
      }
      // encostou no jogador
      if (
        player &&
        p.pos.x > player.min.x - R &&
        p.pos.x < player.max.x + R &&
        p.pos.y > player.min.y - R &&
        p.pos.y < player.max.y + R &&
        p.pos.z > player.min.z - R &&
        p.pos.z < player.max.z + R
      ) {
        on.hitPlayer?.();
        this.kill(p);
        continue;
      }
      if (p.life <= 0) {
        on.pop?.(p.pos.clone());
        this.kill(p);
      }
    }
  }
}
