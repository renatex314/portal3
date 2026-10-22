//! Jogador em primeira pessoa (player.js): anda com o "character controller" da física
//! (colide com o cenário e com cubos/torretas, empurrando-os), gravidade que pode mudar de
//! direção e passagem pelos portais conservando o momento.

use crate::physics::Ent;
use crate::portals::{Portals, Who};
use crate::world::GameWorld;
use bevy::prelude::*;
use rand::Rng;

pub const EYE: f32 = 0.7; // altura do olho acima do centro do corpo
pub const STAND: f32 = 0.9; // meia altura de pé (1,8 m)
pub const CROUCH: f32 = 0.45; // meia altura agachado
pub const EYE_CROUCH: f32 = 0.25;
pub const WALK: f32 = 4.6;
pub const JUMP: f32 = 4.6;
pub const MAX_FALL: f32 = 32.0;
const ROLL_MAX: f32 = 1.6 * std::f32::consts::PI / 180.0;

#[derive(Clone, Copy, Debug, Default)]
pub struct Input {
    pub f: bool,
    pub b: bool,
    pub l: bool,
    pub r: bool,
    pub jump: bool,
    pub crouch: bool,
}

#[derive(Clone, Debug)]
pub struct Player {
    pub pos: Vec3,
    pub vel: Vec3,
    pub half: Vec3,
    pub yaw: f32,
    pub pitch: f32,
    pub grounded: bool,
    pub up_sign: f32,
    pub flip: f32,
    pub cooldown: f32,
    pub ground_time: f32,
    pub bob: f32,
    pub roll: f32,
    pub crouched: bool,
    pub eye_off: f32,
    pub view_offset: Vec3,
    pub view_rot: Quat,
    pub ground: Option<Ent>,
    /// empurrão do mapa (trigger_push)
    pub push: Option<Vec3>,
    pub rumble_t: f32,
    pub in_transit: bool,
}

impl Default for Player {
    fn default() -> Self {
        Player {
            pos: Vec3::ZERO,
            vel: Vec3::ZERO,
            half: Vec3::new(0.3, STAND, 0.3),
            yaw: 0.0,
            pitch: 0.0,
            grounded: false,
            up_sign: 1.0,
            flip: 0.0,
            cooldown: 0.0,
            ground_time: 0.0,
            bob: 0.0,
            roll: 0.0,
            crouched: false,
            eye_off: EYE,
            view_offset: Vec3::ZERO,
            view_rot: Quat::IDENTITY,
            ground: None,
            push: None,
            rumble_t: 0.0,
            in_transit: false,
        }
    }
}

/// o que acontece quando o jogador atravessa um portal (main.js decide: salto no tempo, som...)
pub type OnTeleport<'a> = &'a mut dyn FnMut(usize, &mut Player);

impl Player {
    pub fn spawn(&mut self, w: &mut GameWorld, x: f32, y: f32, z: f32, yaw: f32) {
        if self.crouched {
            self.set_crouch(w, false, true);
        }
        self.eye_off = EYE;
        self.pos = Vec3::new(x, y + self.half.y + 0.05, z);
        self.vel = Vec3::ZERO;
        self.yaw = yaw;
        self.pitch = 0.0;
        self.up_sign = 1.0;
        self.flip = 0.0;
        self.view_offset = Vec3::ZERO;
        self.view_rot = Quat::IDENTITY;
        w.phys.set_player(self.half);
    }

    pub fn eye(&self) -> Vec3 {
        self.pos + Vec3::new(0.0, self.eye_off * self.up_sign, 0.0)
    }

    /// agacha/levanta: no chão os pés ficam; no ar a cabeça fica. Só levanta se couber
    pub fn set_crouch(&mut self, w: &mut GameWorld, on: bool, force: bool) -> bool {
        if on == self.crouched {
            return true;
        }
        let d = (STAND - CROUCH) * self.up_sign;
        let shift = if self.grounded { if on { -d } else { d } } else if on { d } else { -d };
        let center = self.pos + Vec3::new(0.0, shift, 0.0);
        let half = Vec3::new(self.half.x, if on { CROUCH } else { STAND }, self.half.z);
        if !on && !force {
            let solids = &w.solids;
            if !w.phys.fits(center, half, |s| !solids[s].disabled) {
                return false;
            }
        }
        self.crouched = on;
        self.half.y = half.y;
        self.eye_off -= shift;
        self.pos = center;
        w.phys.set_player(self.half);
        true
    }

    pub fn flip_ease(&self) -> f32 {
        let f = self.flip;
        f * f * (3.0 - 2.0 * f)
    }

    pub fn quaternion(&self) -> Quat {
        Quat::from_axis_angle(Vec3::Z, std::f32::consts::PI * self.flip_ease()) * Quat::from_rotation_y(self.yaw) * Quat::from_rotation_x(self.pitch)
    }

    pub fn view_quaternion(&self) -> Quat {
        self.view_rot * self.quaternion()
    }

    pub fn forward(&self) -> Vec3 {
        self.view_quaternion() * Vec3::NEG_Z
    }

    pub fn look(&mut self, dx: f32, dy: f32) {
        self.yaw -= dx * 0.0022;
        self.pitch = (self.pitch - dy * 0.0022).clamp(-1.55, 1.55);
    }

    /// `held`: objeto segurado (não colide com o jogador); `gone(i)`: objeto que sumiu
    pub fn update(&mut self, dt: f32, input: &mut Input, w: &mut GameWorld, portals: &Portals, g: Vec3, held: Option<usize>, gone: &dyn Fn(usize) -> bool, on_teleport: OnTeleport) {
        // de cabeça para baixo quando a gravidade aponta para cima
        if g.y > 0.5 && self.up_sign > 0.0 {
            self.up_sign = -1.0;
        } else if g.y < -0.5 && self.up_sign < 0.0 {
            self.up_sign = 1.0;
        }
        let target_flip = if self.up_sign < 0.0 { 1.0 } else { 0.0 };
        self.flip += (target_flip - self.flip).signum() * (target_flip - self.flip).abs().min(dt / 1.3);

        let q = self.quaternion();
        let up = Vec3::new(0.0, self.up_sign, 0.0);
        let proj = |v: Vec3| (v - up * v.dot(up)).normalize_or_zero();
        let fwd = proj(q * Vec3::NEG_Z);
        let right = proj(q * Vec3::X);
        let mut wish = fwd * ((input.f as i32 - input.b as i32) as f32) + right * ((input.r as i32 - input.l as i32) as f32);
        if wish.length_squared() > 0.0 {
            wish = wish.normalize();
        }
        if input.crouch != self.crouched {
            self.set_crouch(w, input.crouch, false);
        }
        self.eye_off += ((if self.crouched { EYE_CROUCH } else { EYE }) - self.eye_off) * (1.0 - (-dt * 12.0).exp());

        let mut horiz = self.vel - up * self.vel.dot(up);
        let mut vert = self.vel - horiz;
        if self.grounded {
            let mut target = wish * if self.crouched { WALK * 0.5 } else { WALK };
            if let Some(p) = self.push {
                target += p - up * p.dot(up);
            }
            let k = if horiz.length() > WALK * 1.5 { 4.0 } else { 14.0 };
            horiz = horiz.lerp(target, 1.0 - (-k * dt).exp());
            if input.jump {
                vert = up * JUMP;
                self.grounded = false;
                input.jump = false;
            }
        } else {
            // no ar: controle limitado; nunca freia um lançamento
            let next = horiz + wish * (9.0 * dt);
            let cap = WALK.max(horiz.length());
            horiz = if next.length() < cap { next } else { next.normalize_or_zero() * cap };
        }
        self.vel = horiz + vert + g * dt;
        if let Some(p) = self.push.take() {
            let dir = p.normalize_or_zero();
            let along = self.vel.dot(dir);
            let want = p.length();
            if along < want {
                let add = (want - along).min(want * dt * if self.grounded { 0.0 } else { 6.0 } + if p.dot(up) > 0.0 { want } else { 0.0 });
                self.vel += dir * add;
            }
        }
        if self.vel.length() > MAX_FALL {
            self.vel = self.vel.normalize() * MAX_FALL;
        }
        self.funnel(dt, portals, g);
        self.fling_assist(dt, portals, g);

        let prev_center = self.pos;
        let g_up = if g.length_squared() > 0.01 { -g.normalize() } else { up };
        // em cima de uma plataforma/porta que andou: vai junto
        let plat = if self.up_sign > 0.0 { w.doors.iter().position(|d| Some(Ent::Static(d.solid)) == self.ground) } else { None };
        let mut on_plat = None;
        if let Some(pi) = plat {
            if self.vel.dot(g_up) <= 0.05 {
                self.pos += w.doors[pi].delta;
                on_plat = Some(pi);
            }
        }
        // movimento com o controlador: o filtro deixa atravessar a parede de um portal
        let reach = (self.vel * dt).length();
        let mouths = portals.mouths(self.pos, true, reach);
        let delta = self.vel * dt;
        let p1 = self.pos + delta;
        let mn = self.pos.min(p1) - self.half - Vec3::splat(0.05);
        let mx = self.pos.max(p1) + self.half + Vec3::splat(0.05);
        let exclude = on_plat.map(|p| w.doors[p].solid);
        let GameWorld { solids, phys, .. } = w;
        let solids: &Vec<crate::world::Solid> = solids;
        let allow = |e: Ent| -> bool {
            match e {
                Ent::Static(s) => Some(s) != exclude && !solids[s].disabled && !(!mouths.is_empty() && portals.passes(solids, s, &mouths, mn, mx)),
                Ent::Dyn(p) => Some(p) != held && !gone(p),
                Ent::Player => false,
            }
        };
        let mut pos = self.pos;
        let res = phys.move_player(&mut pos, delta, g_up, dt, allow);
        self.pos = pos;
        self.ground = res.ground;
        let mut normals = res.normals;
        if let Some(pi) = on_plat {
            let b = &w.solids[w.doors[pi].solid];
            let over = self.pos.x > b.min.x - self.half.x + 0.05 && self.pos.x < b.max.x + self.half.x - 0.05 && self.pos.z > b.min.z - self.half.z + 0.05 && self.pos.z < b.max.z + self.half.z - 0.05;
            if over && self.pos.y - self.half.y > b.max.y - 0.4 {
                self.pos.y = b.max.y + self.half.y + 0.035;
                if self.vel.y < 0.0 {
                    self.vel.y = 0.0;
                }
                normals.push(g_up);
                self.ground = Some(Ent::Static(w.doors[pi].solid));
            }
        }
        // saiu de cima de uma plataforma em movimento: leva a velocidade dela
        if let Some(pi) = plat {
            if self.ground != Some(Ent::Static(w.doors[pi].solid)) && dt > 0.0 {
                self.vel += w.doors[pi].delta / dt;
            }
        }
        // (o controlador do Rapier em Rust às vezes diz "no chão" sem listar a colisão com o chão:
        // a velocidade para baixo também acaba aí, senão ela se acumula parado)
        if res.grounded && g.length_squared() > 0.01 && !normals.iter().any(|n| n.dot(g_up) > 0.7) {
            let vn = self.vel.dot(g_up);
            if vn < 0.0 {
                self.vel -= g_up * vn;
            }
        }
        let mut ground = false;
        for n in &normals {
            let vn = self.vel.dot(*n);
            if vn < 0.0 {
                self.vel -= *n * vn;
            }
            if n.dot(g_up) > 0.7 {
                ground = true;
            }
        }
        self.grounded = g.length_squared() > 0.01 && (ground || (res.grounded && self.vel.dot(g_up) <= 0.05));
        if self.grounded && horiz.length_squared() < 0.01 {
            self.ground_time += dt;
        } else {
            self.ground_time = 0.0;
        }
        self.view_offset *= (-dt * 9.0).exp();
        self.view_rot = self.view_rot.slerp(Quat::IDENTITY, 1.0 - (-dt * 6.0).exp());

        // atravessou um portal? conta o CENTRO DE MASSA
        self.cooldown -= dt;
        let mut crossed = None;
        if self.cooldown <= 0.0 {
            crossed = portals.crossing(prev_center, self.pos, Who::Player);
            if crossed.is_none() {
                crossed = portals.stuck_in(&w.solids, self.pos, self.pos - self.half, self.pos + self.half, 0.45);
            }
        }
        if let Some(p) = crossed {
            self.teleport(portals, p, g);
            on_teleport(p, self);
        }
        if input.f || input.b || input.l || input.r {
            self.bob += dt * if self.grounded { 9.0 } else { 0.0 };
        }
    }

    /// funil: caindo por cima de um portal no chão, a trajetória é puxada para o centro dele
    fn funnel(&mut self, dt: f32, portals: &Portals, g: Vec3) {
        let gm = g.length();
        if gm < 0.01 {
            return;
        }
        let down = g / gm;
        let v_down = self.vel.dot(down);
        if v_down < 1.0 {
            return;
        }
        let side_now = self.vel - down * v_down;
        if side_now.length() > 6.0 {
            return;
        }
        let mut best: Option<(Vec3, f32)> = None;
        let mut best_d = f32::INFINITY;
        for (i, p) in portals.list.iter().enumerate() {
            if !portals.is_linked(i) || p.delta > 0.0 || p.normal.dot(down) > -0.7 {
                continue;
            }
            let rel = self.pos - p.center;
            let h = rel.dot(p.normal);
            if !(0.3..=60.0).contains(&h) {
                continue;
            }
            let lat = rel - p.normal * h;
            let d = lat.length();
            let reach = (1.5 + h * 0.1).clamp(2.6, 6.0);
            if d < reach && d < best_d {
                best_d = d;
                best = Some((lat, h));
            }
        }
        let Some((lat, h)) = best else { return };
        let t = ((-v_down + (v_down * v_down + 2.0 * gm * h).sqrt()) / gm).max(0.05);
        let want = lat * (-1.0 / t);
        let mut dv = (want - side_now) * (1.0 - (-dt * 6.0).exp());
        let max_dv = 12.0 * dt;
        if dv.length() > max_dv {
            dv = dv.normalize() * max_dv;
        }
        self.vel += dv;
    }

    /// ajuda de arremesso: voando rápido de encontro a um portal, corrige a velocidade lateral
    fn fling_assist(&mut self, dt: f32, portals: &Portals, g: Vec3) {
        let speed = self.vel.length();
        if speed < 8.0 {
            return;
        }
        let mut best: Option<(f32, Vec3)> = None;
        for (i, p) in portals.list.iter().enumerate() {
            if !portals.is_linked(i) || p.delta > 0.0 {
                continue;
            }
            let vn = -self.vel.dot(p.normal);
            if vn < speed * 0.35 {
                continue;
            }
            let h = (self.pos - p.center).dot(p.normal);
            if !(0.2..=30.0).contains(&h) {
                continue;
            }
            let gn = g.dot(p.normal);
            let mut t = h / vn;
            if gn.abs() > 1e-3 {
                let disc = vn * vn - 2.0 * gn * h;
                if disc < 0.0 {
                    continue;
                }
                t = (vn - disc.sqrt()) / gn;
                if !(t > 0.0) {
                    t = h / vn;
                }
            }
            if t > 3.0 {
                continue;
            }
            let hit = self.pos + self.vel * t + g * (0.5 * t * t) - p.center;
            let off = hit - p.normal * hit.dot(p.normal);
            let d = off.length();
            if d < 4.5 && best.map(|b| t < b.0).unwrap_or(true) {
                best = Some((t, off));
            }
        }
        let Some((t, off)) = best else { return };
        let want = off * (-1.0 / t.max(0.08));
        let mut dv = want * (1.0 - (-dt * 8.0).exp());
        let max_dv = 14.0 * dt;
        if dv.length() > max_dv {
            dv = dv.normalize() * max_dv;
        }
        self.vel += dv;
    }

    pub fn teleport(&mut self, portals: &Portals, p: usize, g: Vec3) {
        let view = self.eye() + self.view_offset;
        let view_q = self.view_quaternion();
        let (q, m, rot) = portals.carry(p, &mut self.pos, &mut self.vel);
        let view = m.transform_point3(view);
        let view_q = rot * view_q;
        // saída numa parede: o corpo (de pé) sai inteiro da boca
        let qq = &portals.list[q];
        let n = qq.normal;
        if n.y.abs() < 0.5 {
            let need = n.x.abs() * self.half.x + n.z.abs() * self.half.z + 0.03;
            let d = (self.pos - qq.center).dot(n);
            if d < need {
                self.pos += n * (need - d);
            }
        }
        // nova direção do olhar sem inclinação lateral (o giro fica em view_rot)
        let unflip = Quat::from_axis_angle(Vec3::Z, -std::f32::consts::PI * self.flip_ease());
        let f = unflip * (view_q * Vec3::NEG_Z);
        let u = unflip * (view_q * Vec3::Y);
        let sp = f.y.clamp(-0.999, 0.999);
        let cp = (1.0 - sp * sp).sqrt();
        let hx = f.x * cp - u.x * sp;
        let hz = f.z * cp - u.z * sp;
        self.pitch = sp.asin().clamp(-1.55, 1.55);
        if hx * hx + hz * hz > 1e-8 {
            self.yaw = (-hx).atan2(-hz);
        }
        self.view_rot = view_q * self.quaternion().inverse();
        self.view_offset = view - self.eye();
        let side = Vec3::new(-self.yaw.sin(), 0.0, -self.yaw.cos());
        portals.exit_assist(q, self.pos, &mut self.vel, self.half, g, side);
        self.cooldown = 0.12;
        self.grounded = false;
    }

    /// posição e giro da câmera (balanço, tremida, inclinação lateral, vista pelo portal)
    pub fn camera(&mut self, dt: f32, portals: &Portals, shake: f32, rumble: f32) -> Transform {
        let b = self.bob.sin() * 0.035 * if self.grounded { 1.0 } else { 0.0 };
        let mut pos = self.eye() + self.view_offset + Vec3::new(0.0, b * self.up_sign, 0.0);
        if shake > 0.0 {
            let mut r = rand::rng();
            pos += Vec3::new(r.random::<f32>() - 0.5, r.random::<f32>() - 0.5, r.random::<f32>() - 0.5) * shake;
        }
        let mut quat = self.view_quaternion();
        self.rumble_t += dt.max(1.0 / 240.0);
        if rumble > 0.001 {
            let t = self.rumble_t;
            let r = rumble * rumble;
            let yaw = r * 0.016 * ((t * 43.1).sin() + 0.6 * (t * 71.7 + 1.3).sin() + 0.3 * (t * 113.0 + 0.4).sin());
            let pitch = r * 0.013 * ((t * 51.3 + 0.7).sin() + 0.5 * (t * 89.9 + 2.1).sin() + 0.3 * (t * 131.0 + 1.7).sin());
            let roll = r * 0.022 * ((t * 29.7 + 2.0).sin() + 0.4 * (t * 61.1).sin());
            quat *= Quat::from_euler(EulerRot::YXZ, yaw, pitch, roll);
            pos += quat * Vec3::new((t * 37.3).sin(), (t * 47.9 + 0.5).sin(), 0.0) * (r * 0.025);
        }
        // andando de lado a câmera inclina levemente para o lado do movimento
        let right = quat * Vec3::X;
        let side = (self.vel.dot(right) / WALK).clamp(-1.5, 1.5);
        if dt > 0.0 {
            self.roll += (-side * ROLL_MAX - self.roll) * (1.0 - (-dt * 9.0).exp());
        }
        if self.roll.abs() > 1e-5 {
            quat *= Quat::from_axis_angle(Vec3::Z, self.roll);
        }
        // câmera atrás da boca de um portal: desenha do ponto equivalente do outro lado
        let behind = portals.behind(pos);
        self.in_transit = behind.is_some() || self.view_offset.length_squared() > 0.02;
        if let Some(p) = behind {
            let m = portals.transform(p, portals.list[p].partner);
            pos = m.transform_point3(pos);
            quat = Quat::from_mat4(&m) * quat;
        }
        Transform::from_translation(pos).with_rotation(quat)
    }
}

