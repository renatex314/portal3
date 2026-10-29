// Passe de cena (antes do tom): desfoque de movimento por reprojeção, névoa de calor sobre a rocha
// fundida, a lente do campo de dilatação e a onda de choque do tiro (fx.js da versão web).

import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput;

struct SceneFx {
    world_from_clip: mat4x4<f32>,
    prev_clip_from_world: mat4x4<f32>,
    cam: vec4<f32>,
    blur: vec4<f32>,
    lakes: array<vec4<f32>, 12>,
    tops: array<vec4<f32>, 3>,
    misc: vec4<f32>,
    shock: vec4<f32>,
    shock2: vec4<f32>,
    lens: vec4<f32>,
    lens2: vec4<f32>,
    lens3: vec4<f32>,
    clip_from_world: mat4x4<f32>,
};

@group(0) @binding(0) var screen: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> fx: SceneFx;
@if(MULTISAMPLED)
@group(0) @binding(3) var depth_tex: texture_depth_multisampled_2d;
@if(!MULTISAMPLED)
@group(0) @binding(3) var depth_tex: texture_depth_2d;

fn depth_at(uv: vec2<f32>) -> f32 {
    let size = vec2<f32>(textureDimensions(depth_tex));
    let p = vec2<i32>(clamp(uv, vec2<f32>(0.0), vec2<f32>(0.9999)) * size);
    return textureLoad(depth_tex, p, 0);
}

fn world_at(uv: vec2<f32>, d: f32) -> vec3<f32> {
    let ndc = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
    let w = fx.world_from_clip * ndc;
    return w.xyz / w.w;
}

fn tex(uv: vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(screen, samp, uv, 0.0).rgb;
}

fn hh(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn vn(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hh(i), hh(i + vec2<f32>(1.0, 0.0)), u.x), mix(hh(i + vec2<f32>(0.0, 1.0)), hh(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn fbm(p: vec2<f32>) -> f32 { return 0.55 * vn(p) + 0.3 * vn(p * 2.1 + 3.7) + 0.15 * vn(p * 4.3 + 9.1); }

// ---- lente (o núcleo: normais de um fluxo, anéis pulsando, refração borrada)
fn nrm(p: vec2<f32>) -> vec2<f32> {
    let e = 0.04;
    return vec2<f32>(fbm(p + vec2<f32>(e, 0.0)) - fbm(p - vec2<f32>(e, 0.0)), fbm(p + vec2<f32>(0.0, e)) - fbm(p - vec2<f32>(0.0, e))) / (2.0 * e);
}
fn flow_normal(e: vec2<f32>, t: f32) -> vec2<f32> {
    let ff = (vec2<f32>(vn(e * 1.4 + 11.0 + t * 0.05), vn(e * 1.4 + 23.0 - t * 0.04)) - 0.5) * 2.0;
    let tt = t * 0.22;
    let p0 = fract(tt);
    let p1 = fract(tt + 0.5);
    let a = nrm(e * 3.0 - ff * p0 * 1.2);
    let b = nrm(e * 3.0 - ff * p1 * 1.2 + 4.7);
    return mix(a, b, abs(1.0 - 2.0 * p0));
}
fn core_pattern(fres: f32, ang: f32, t: f32) -> f32 {
    let u = fres * 3.2 - t * 0.35 + 0.18 * sin(t * 1.7 + fres * 6.0);
    let v = ang / 6.2831853;
    let rings = 0.5 + 0.5 * sin(u * 6.2831853 * 1.5 + fbm(vec2<f32>(v * 6.0, u * 0.7)) * 3.0);
    return mix(fbm(vec2<f32>(u * 2.0, v * 9.0)), rings, 0.55);
}
/// ponto relativo ao centro da esfera (z para a câmera) → deslocamento na tela
// ponto do mundo → tela (0..1)
fn to_screen(w: vec3<f32>) -> vec2<f32> {
    let c = fx.clip_from_world * vec4<f32>(w, 1.0);
    // atrás da câmera a divisão inverteria o lado: nesse caso vai para a borda da tela, na direção certa
    var q = c.xy / max(c.w, 1e-4);
    if (c.w < 1e-3) {
        q = normalize(c.xy + vec2<f32>(1e-6)) * 8.0;
    }
    q = clamp(q, vec2<f32>(-8.0), vec2<f32>(8.0));
    return vec2<f32>(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
}

fn lens_proj(p: vec3<f32>, dd: f32, kk: f32) -> vec2<f32> {
    return vec2<f32>(p.x, -p.y) / max(dd - p.z, 0.2) * kk;
}

fn blur_at(uv: vec2<f32>, rad: f32, aspect: f32) -> vec3<f32> {
    let o = vec2<f32>(rad / aspect, rad);
    var c = tex(uv) * 0.4;
    c += tex(uv + vec2<f32>(o.x, 0.0)) * 0.15;
    c += tex(uv - vec2<f32>(o.x, 0.0)) * 0.15;
    c += tex(uv + vec2<f32>(0.0, o.y)) * 0.15;
    c += tex(uv - vec2<f32>(0.0, o.y)) * 0.15;
    return c;
}

fn ro_dir(wp: vec3<f32>) -> vec3<f32> { return wp - fx.cam.xyz; }

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    var uv = in.uv;
    let aspect = fx.misc.y;
    let t = fx.cam.w;
    // ---- onda de choque: puxa a imagem para dentro na frente da onda, empurra atrás
    if (fx.shock.z < 1.0) {
        var d = uv - fx.shock.xy;
        d.x *= aspect;
        let r = length(d);
        let e = 1.0 - pow(1.0 - fx.shock.z, 3.0);
        let rr = 0.015 + e * fx.shock.w;
        let w = mix(0.015, 0.04, e) * fx.shock2.y;
        let x = (r - rr) / w;
        let band = exp(-x * x);
        let fade = pow(1.0 - fx.shock.z, 1.4);
        var dir = vec2<f32>(0.0);
        if (r > 1e-4) { dir = d / r; }
        var off = dir * (-x * band * fx.shock2.x * fade);
        off.x /= aspect;
        uv += off;
    }
    // ---- névoa de calor: quanto do raio câmera → superfície passa pelo ar quente sobre a lava
    let d0 = depth_at(uv);
    let wp = world_at(uv, d0);
    // normal da superfície vista (das diferenças entre pixels vizinhos): o contato da bolha
    // (em cada eixo usa o vizinho mais próximo em profundidade: nas silhuetas dos objetos a
    // diferença cruzaria dois objetos e desenharia o contorno deles através do campo)
    let px = 1.0 / vec2<f32>(textureDimensions(depth_tex));
    let wl = world_at(uv - vec2<f32>(px.x, 0.0), depth_at(uv - vec2<f32>(px.x, 0.0)));
    let wr = world_at(uv + vec2<f32>(px.x, 0.0), depth_at(uv + vec2<f32>(px.x, 0.0)));
    let wu = world_at(uv - vec2<f32>(0.0, px.y), depth_at(uv - vec2<f32>(0.0, px.y)));
    let wd = world_at(uv + vec2<f32>(0.0, px.y), depth_at(uv + vec2<f32>(0.0, px.y)));
    let ex = select(wr - wp, wp - wl, length(wl - wp) < length(wr - wp));
    let ey = select(wd - wp, wp - wu, length(wu - wp) < length(wd - wp));
    var wn_raw = cross(ex, ey);
    if (dot(wn_raw, ro_dir(wp)) > 0.0) { wn_raw = -wn_raw; }
    let wn = select(vec3<f32>(0.0, 1.0, 0.0), normalize(wn_raw), dot(wn_raw, wn_raw) > 1e-12);
    let ro = fx.cam.xyz;
    let rd = wp - ro;
    // ---- oclusão de ambiente: 8 amostras no hemisfério da superfície (cantos, vãos e o contato dos
    // objetos com o chão ficam um pouco mais escuros)
    var occ = 1.0;
    if (fx.misc.z > 0.0 && d0 > 1e-6) {
        let dist = max(length(rd), 0.3);
        let aspect_ = fx.misc.y;
        let rad_w = 0.7;
        // raio na tela proporcional ao tamanho do raio do mundo na distância da superfície
        let proj = fx.clip_from_world * vec4<f32>(wp + vec3<f32>(rad_w, 0.0, 0.0), 1.0);
        let proj0 = fx.clip_from_world * vec4<f32>(wp, 1.0);
        let rs = clamp(abs(proj.x / max(proj.w, 1e-4) - proj0.x / max(proj0.w, 1e-4)) * 0.5, 0.0, 0.08);
        let rot = hh(in.position.xy) * 6.2831853;
        var sum = 0.0;
        for (var i = 0; i < 8; i++) {
            let fi = f32(i);
            let a = rot + fi * 2.39996;
            let r = sqrt((fi + 0.5) / 8.0);
            let suv = uv + vec2<f32>(cos(a) / aspect_, sin(a)) * rs * r;
            let sp = world_at(suv, depth_at(suv));
            let v = sp - wp;
            let l2 = dot(v, v);
            let h = dot(v, wn) - 0.04;
            // só conta o que está perto (acima do raio, é outro objeto)
            sum += max(h, 0.0) / sqrt(l2 + 0.0004) * (1.0 - smoothstep(rad_w * 0.6, rad_w * 1.4, sqrt(l2)));
        }
        occ = 1.0 - clamp(sum / 8.0 * 1.15, 0.0, 0.55) * fx.misc.z;
        // distante demais: some aos poucos
        occ = mix(occ, 1.0, smoothstep(30.0, 70.0, dist));
    }
    var s = 0.0;
    let n = i32(fx.misc.x);
    for (var i = 0; i < 12; i++) {
        if (i >= n) { break; }
        let top = fx.tops[i / 4][i % 4];
        let lo = vec3<f32>(fx.lakes[i].x, top, fx.lakes[i].y);
        let hi = vec3<f32>(fx.lakes[i].z, top + 3.2, fx.lakes[i].w);
        let inv = 1.0 / (rd + vec3<f32>(1e-6));
        let a = (lo - ro) * inv;
        let b = (hi - ro) * inv;
        let mn = min(a, b);
        let mx = max(a, b);
        let t0 = max(max(mn.x, mn.y), max(mn.z, 0.0));
        let t1 = min(min(mx.x, mx.y), min(mx.z, 1.0));
        if (t1 <= t0) { continue; }
        let l = (t1 - t0) * length(rd);
        let y = (ro.y + rd.y * (t0 + t1) * 0.5 - top) / 3.2;
        let k = 1.0 - clamp(y, 0.0, 1.0);
        s += l * k * k * 0.16;
    }
    s = clamp(s, 0.0, 1.0);
    var glow = vec3<f32>(0.0);
    if (s > 0.003) {
        let q = vec2<f32>(uv.x * aspect, uv.y);
        var off = vec2<f32>(vn(q * 38.0 + vec2<f32>(0.0, t * 2.2)) - 0.5, vn(q * 31.0 + vec2<f32>(5.2, t * 2.8)) - 0.5);
        off += 0.5 * vec2<f32>(vn(q * 90.0 + vec2<f32>(0.0, t * 4.0)) - 0.5, 0.0);
        uv += off * 0.012 * s;
        glow = vec3<f32>(1.0, 0.33, 0.07) * s * (0.16 + 0.05 * sin(t * 1.7));
    }
    // ---- desfoque de movimento: cada pixel volta para onde estava no quadro anterior
    var col = tex(uv);
    if (fx.blur.w > 0.5) {
        let p = fx.prev_clip_from_world * vec4<f32>(wp, 1.0);
        let prev = vec2<f32>(p.x / p.w * 0.5 + 0.5, 0.5 - p.y / p.w * 0.5);
        var vel = (uv - prev) * fx.blur.x;
        vel += (uv - 0.5) * fx.blur.z;
        let len = length(vel);
        if (len > fx.blur.y) { vel *= fx.blur.y / len; }
        if (length(vel) * 1500.0 >= 1.0) {
            var sum = col;
            for (var i = 0; i < 12; i++) {
                let k = (f32(i) + 0.5) / 12.0 - 0.5;
                sum += tex(uv + vel * k);
            }
            col = sum / 13.0;
        }
    }
    col *= occ;
    col += glow;
    // ---- lente do campo de dilatação
    let fade = fx.lens.w;
    if (fade > 0.001) {
        let center = fx.lens.xy;
        let rr = fx.lens.z;
        var d = uv - center;
        d.x *= aspect;
        let r = length(d) + 1e-5;
        let x = r / rr;
        let dir = d / r;
        let e = d / rr;
        let ang = atan2(dir.y, -dir.x);
        let to_uv = vec2<f32>(1.0 / aspect, 1.0);
        if (fx.lens2.x > 0.5) {
            let side = smoothstep(0.2, 1.2, x);
            let fnn = flow_normal(e * 0.9, t);
            let q = mix(d, d + fnn * rr * (0.03 + 0.06 * side), fade);
            let refr = min(blur_at(center + q * to_uv, 0.002 + 0.004 * side, aspect), vec3<f32>(1.4));
            let pat = core_pattern(clamp(x * 0.8, 0.0, 1.0), ang, t);
            let tint = mix(vec3<f32>(0.55, 0.85, 0.95), vec3<f32>(0.85, 1.0, 1.05), pat);
            col = mix(refr, refr * tint + vec3<f32>(0.03, 0.09, 0.12) * pat * side, (0.4 + 0.5 * side) * fade);
        } else if (fx.lens3.w > 0.0) {
            // de fora: a esfera de vidro de verdade (coreSphere.js), no espaço do mundo, com o raio
            // de cada pixel: entra (ar → vidro), atravessa e sai do outro lado; a imagem refratada
            // é lida onde o raio de saída cai na tela
            let C = fx.lens3.xyz;
            let rw = fx.lens2.y;
            let ud = fx.lens3.w;
            let ro = fx.cam.xyz;
            let to_s = wp - ro;
            let scene_t = length(to_s);
            let V = to_s / max(scene_t, 1e-5);
            let oc = ro - C;
            let b = dot(oc, V);
            let h = b * b - (dot(oc, oc) - rw * rw);
            // (t0 > 0: a esfera tem de estar na frente do raio; atrás da câmera a reta também a
            // cruza e desenhava uma cópia espelhada do outro lado da tela)
            if (h > 0.0 && -b - sqrt(h) > 0.0) {
                let t0 = -b - sqrt(h);
                let W = ro + V * t0;
                let Nw = normalize(W - C);
                let facing = clamp(dot(-V, Nw), 0.0, 1.0);
                let fres = 1.0 - facing;
                // anéis e fluxo: ondulam de leve a normal (o ruído no espaço da casca)
                let fnn = flow_normal(e, t);
                let u = fres * 3.2 - t * 0.35 + 0.18 * sin(t * 1.7 + fres * 6.0);
                let rings = sin(u * 9.42);
                var tang = vec3<f32>(fnn.x, fnn.y, 0.0);
                tang -= Nw * dot(tang, Nw);
                let N1 = normalize(Nw + (tang * 0.06 + Nw * rings * 0.015) * fade * ud);
                let eta = 1.0 / mix(1.0, 1.33, fade * ud);
                let r1 = refract(V, N1, eta);
                let tin = max(-2.0 * dot(r1, W - C), 0.0);
                let P2 = W + r1 * tin;
                let N2 = normalize(P2 - C);
                var r2 = refract(r1, -N2, 1.0 / eta);
                if (dot(r2, r2) < 1e-4) { r2 = reflect(r1, -N2); }
                let refr = min(blur_at(to_screen(P2 + r2 * 6.0), 0.0015, aspect), vec3<f32>(1.3));
                // absorção: ciano mais forte no meio, mais claro na borda
                let absorb = exp(-(vec3<f32>(1.0) - vec3<f32>(0.17, 0.62, 0.75)) * tin / (rw * 2.2));
                var sph = refr * mix(vec3<f32>(1.0), absorb * vec3<f32>(0.92, 1.0, 1.05), fade);
                // reflexo (Fresnel de Schlick): a sala refletida na casca e as luzes de cima
                let ff = 0.04 + 0.96 * pow(fres, 5.0);
                let R = reflect(V, N1);
                let refl = min(tex(to_screen(W + R * 4.0)), vec3<f32>(1.3)) * 0.85 + vec3<f32>(0.12, 0.2, 0.24) * max(R.y, 0.0);
                sph = mix(sph, refl, ff * fade);
                let spec = pow(max(dot(R, normalize(vec3<f32>(-0.25, 1.0, 0.15))), 0.0), 140.0) + 0.5 * pow(max(dot(R, normalize(vec3<f32>(0.3, 1.0, -0.3))), 0.0), 220.0);
                sph += vec3<f32>(1.0) * spec * 2.2 * fade;
                sph += vec3<f32>(0.22, 0.7, 1.0) * pow(fres, 3.0) * 0.45 * fade;
                // profundidade: o que está na frente da casca esconde a esfera; perto do contato com
                // uma superfície ela vai sumindo (distância até a superfície, não ao longo do raio)
                var vis = smoothstep(0.0, 0.45, (scene_t - t0) * abs(dot(V, wn)));
                // borda sem serrilhado
                vis *= smoothstep(0.0, 0.02, h / (rw * rw));
                col = mix(col, sph, vis);
            }
        }
    }
    return vec4<f32>(col, 1.0);
}
