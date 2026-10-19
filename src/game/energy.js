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

const _z = new THREE.Vector3(0, 0, 1);
const HINT_GEO = new THREE.PlaneGeometry(1.6, 1.6);
let HINT_MAT = null;
/** brilho verde redondo, suave nas bordas, pulsando devagar */
function hintMaterial() {
  HINT_MAT ??= new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uT; varying vec2 vUv;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        float glow = smoothstep(1.0, 0.0, r);
        float ring = smoothstep(0.08, 0.0, abs(r - 0.62)) * 0.6;
        float a = (glow * glow * 0.32 + ring * 0.35) * (0.75 + 0.25 * sin(uT * 2.2));
        gl_FragColor = vec4(vec3(0.35, 1.6, 0.6) * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    toneMapped: false,
  });
  return HINT_MAT;
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
    const p = { uid: `b${(this.uidSeq = (this.uidSeq ?? 0) + 1)}`, pos: L.pos.clone(), vel: L.dir.clone().multiplyScalar(L.speed), life: L.life, from: L, group: g, sprite: sp, shell, trail, hist, light, cooldown: 0 };
    L.pellet = p;
    this.pellets.push(p);
    return p;
  }

  /** bola solta (sem lançador): a que veio do passado pelo par temporal */
  spawnFree(pos, vel, life) {
    const from = { pos: pos.clone(), dir: vel.clone().normalize(), speed: vel.length(), life, pellet: null, free: true };
    const p = this.spawn(from);
    from.pellet = null; // não segura um lançador
    p.free = true;
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

  /** raio contra as caixas orientadas dos objetos físicos (cubos, torretas) */
  rayProps(props, origin, dir, maxDist) {
    let best = null;
    for (const pr of props) {
      if (pr.gone || !pr.half) continue;
      const qi = pr.quat.clone().invert();
      const o = origin.clone().sub(pr.pos).applyQuaternion(qi);
      const d = dir.clone().applyQuaternion(qi);
      let t0 = 0;
      let t1 = maxDist;
      let axis = -1;
      let sign = 0;
      for (let i = 0; i < 3; i++) {
        const h = pr.half.getComponent(i) + R;
        const oi = o.getComponent(i);
        const di = d.getComponent(i);
        if (Math.abs(di) < 1e-9) {
          if (oi < -h || oi > h) t0 = Infinity;
          continue;
        }
        let ta = (-h - oi) / di;
        let tb = (h - oi) / di;
        let s = -Math.sign(di);
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) {
          t0 = ta;
          axis = i;
          sign = s;
        }
        t1 = Math.min(t1, tb);
      }
      if (axis < 0 || t0 > t1 || (best && t0 >= best.dist)) continue;
      const n = new THREE.Vector3().setComponent(axis, sign).applyQuaternion(pr.quat);
      best = { dist: t0, point: origin.clone().addScaledVector(dir, t0), normal: n, prop: pr }; // centro da bola no contato
    }
    return best;
  }

  /**
   * avança as bolas; `player` = { min, max } do corpo. Eventos em `on`:
   * bounce(pos), caught(catcher), pop(pos), hitPlayer()
   */
  /**
   * Dica de mira: uma luz verde suave na parede em frente a cada lançador e receptor
   * (onde um portal ali leva/recebe a bola). Só aparece em superfície que aceita portal.
   */
  updateHints(world, t) {
    this.hintT = (this.hintT ?? 0) - 1;
    const recast = this.hintT <= 0;
    if (recast) this.hintT = 12; // refaz o raio a cada ~12 quadros (os lançadores podem girar)
    const items = [...world.launchers.map((L) => ({ o: L, from: L.pos, dir: L.dir })), ...world.catchers.map((C) => ({ o: C, from: C.pos, dir: C.normal }))];
    for (const { o, from, dir } of items) {
      if (!o.hint) {
        o.hint = new THREE.Mesh(HINT_GEO, hintMaterial());
        o.hint.renderOrder = 4;
        o.hint.visible = false;
        world.group.add(o.hint);
      }
      if (recast) {
        const hit = world.raycast(from.clone().addScaledVector(dir, 0.3), dir, 60);
        const ok = hit && (hit.box.portalAt ? hit.box.portalAt(hit.normal) : hit.box.portalable);
        o.hint.visible = !!ok;
        if (ok) {
          o.hint.position.copy(hit.point).addScaledVector(hit.normal, 0.02);
          o.hint.quaternion.setFromUnitVectors(_z, hit.normal);
        }
      }
      if (o.hint.visible) o.hint.material.uniforms.uT.value = t;
    }
  }

  update(dt, t, world, portals, player, on = {}) {
    this.updateHints(world, t);
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
      // buraco negro: a trajetória curva (a velocidade não muda); no horizonte, some
      let swallowed = false;
      for (const B of world.blackHoles ?? []) {
        const d = B.pos.clone().sub(p.pos);
        const r = d.length();
        if (r < B.horizon * 1.2) swallowed = true;
        if (r > B.reach) continue;
        const sp = p.vel.length();
        p.vel.addScaledVector(d.divideScalar(r), Math.min(B.strength / Math.max(r * r, 1), 60) * dt);
        p.vel.setLength(sp);
      }
      if (swallowed) {
        on.pop?.(p.pos.clone());
        this.kill(p);
        continue;
      }
      // passos curtos: a bola nunca atravessa uma parede fina
      let rest = p.vel.length() * dt;
      let entered = false;
      while (rest > 1e-4) {
        const step = Math.min(rest, 0.12);
        rest -= step;
        const dir = p.vel.clone().normalize();
        const next = p.pos.clone().addScaledVector(dir, step);
        // azul temporal: a bola vai para o passado (o relógio simula; paradoxo = ela some)
        const TB = p.cooldown <= 0 && on.toPast ? portals.temporalCrossing?.(p.pos, next) : null;
        if (TB) {
          const res = on.toPast(p, TB);
          if (res) {
            if (res === 'paradox') on.pop?.(p.pos.clone());
            this.kill(p);
            entered = true;
            break;
          }
        }
        const P = p.cooldown <= 0 ? portals.crossing(p.pos, next) : null;
        if (P) {
          p.pos.copy(next);
          portals.carry(P, p.pos, p.vel);
          p.cooldown = 0.1;
          p.life = Math.max(p.life, p.from?.life ?? 0); // passou pelo portal: o tempo recomeça
          continue;
        }
        // cubos e torretas desviam a bola (e levam um empurrão dela)
        const ph = this.rayProps(on.props?.() ?? [], p.pos, dir, step + R);
        if (ph) {
          p.pos.copy(ph.point).addScaledVector(ph.normal, 0.002);
          p.vel.addScaledVector(ph.normal, -2 * p.vel.dot(ph.normal));
          const b = ph.prop.body;
          if (b && !ph.prop.held) {
            // a bola é bem mais "pesada" que eles: o golpe vale uns 4–5 m/s de uma vez; na
            // torreta, no alto do corpo, para tombá-la (caída, ela desliga)
            const turret = ph.prop.kind === 'turret';
            const imp = dir.clone().setY(Math.max(dir.y, turret ? 0 : 0.15)).normalize().multiplyScalar(b.mass() * (turret ? 5 : 4));
            const at = turret ? ph.prop.pos.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(ph.prop.quat), ph.prop.half.y * 0.75) : ph.point.clone().addScaledVector(ph.normal, -R);
            b.applyImpulseAtPoint({ x: imp.x, y: imp.y, z: imp.z }, { x: at.x, y: at.y, z: at.z }, true);
          }
          on.bounce?.(p.pos);
          continue;
        }
        const hit = world.raycast(p.pos, dir, step + R);
        // bateu onde há um portal ligado: não quica, segue até cruzar o plano dele
        const intoPortal =
          hit &&
          portals.list.some((Q) => {
            if (!portals.isLinked(Q) || Q.delta > 0 || (Q.partner.delta > 0 && !on.toPast) || Q.box !== hit.box) return false;
            const l = Q.local(hit.point);
            return (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 1;
          });
        // o laranja temporal (aberto no passado): a bola entra e sai pelo azul Δ s depois
        // (o seu ou o de uma versão passada sua)
        if (hit && !intoPortal)
          for (const O of portals.list) {
            if (!O.placed || !(O.delta > 0) || !portals.isLinked(O)) continue;
            const l = O.local(hit.point);
            if (Math.abs(l.z) < 0.1 && (l.x / PORTAL_A) ** 2 + (l.y / PORTAL_B) ** 2 <= 1 && on.intoPast?.(p, O)) {
              this.kill(p);
              entered = true;
              break;
            }
          }
        // o vermelho de uma versão passada sua, visto do passado (fundo preto): a bola some
        // ali e sai pelo ciano Δ s depois
        if (hit && !intoPortal && !entered && on.intoGhost?.(p, hit.point)) {
          this.kill(p);
          entered = true;
        }
        if (entered) break;
        if (hit && !intoPortal) {
          p.pos.copy(hit.point).addScaledVector(hit.normal, R + 0.002);
          p.vel.addScaledVector(hit.normal, -2 * p.vel.dot(hit.normal));
          on.bounce?.(p.pos);
          continue;
        }
        p.pos.copy(next);
      }
      if (entered) continue;
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
      const C = world.catchers.find((c) => !c.active && c.pos.distanceTo(p.pos) < (c.radius ?? 0.8));
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
