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
    let ro = fx.cam.xyz;
    let rd = wp - ro;
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
        } else if (x <= 1.0) {
            // de fora: a esfera de vidro como uma lente de bola (coreSphere.js). lens2 = (0, raio no
            // mundo, distância da câmera ao centro, 0,5 / tan(fov/2)); o ponto (x, y, z) relativo ao
            // centro (z para a câmera) cai na tela em (x, y) / (D − z) · k
            let rw = fx.lens2.y;
            let dd = fx.lens2.z;
            let kk = fx.lens2.w;
            let z = sqrt(max(0.0, 1.0 - x * x));
            let fres = 1.0 - z;
            // anéis e fluxo: ondulam de leve a normal
            let fnn = flow_normal(e, t);
            let u = fres * 3.2 - t * 0.35 + 0.18 * sin(t * 1.7 + fres * 6.0);
            let rings = sin(u * 9.42);
            var n1 = normalize(vec3<f32>(e.x, -e.y, z) + vec3<f32>(fnn.x, -fnn.y, 0.0) * 0.06 * fade + vec3<f32>(e.x, -e.y, z) * rings * 0.015 * fade);
            let v = vec3<f32>(0.0, 0.0, -1.0);
            let eta = 1.0 / mix(1.0, 1.33, fade);
            let r1 = refract(v, n1, eta);
            let p1 = n1 * rw;
            let tin = max(-2.0 * dot(r1, p1), 0.0);
            let p2 = p1 + r1 * tin;
            let n2 = normalize(p2);
            var r2 = refract(r1, -n2, 1.0 / eta);
            if (dot(r2, r2) < 1e-4) { r2 = reflect(r1, -n2); }
            let far = p2 + r2 * 6.0;
            let su = center + lens_proj(far, dd, kk) * to_uv;
            let refr = min(blur_at(su, 0.0015, aspect), vec3<f32>(1.3));
            // absorção: ciano mais forte no meio, mais claro na borda
            let absorb = exp(-(vec3<f32>(1.0) - vec3<f32>(0.17, 0.62, 0.75)) * tin / (rw * 2.2));
            var sph = refr * mix(vec3<f32>(1.0), absorb * vec3<f32>(0.92, 1.0, 1.05), fade);
            // reflexo (Fresnel de Schlick): a sala refletida na casca e as luzes de cima
            let ff = 0.04 + 0.96 * pow(fres, 5.0);
            let rr2 = reflect(v, n1);
            let refl = min(tex(center + lens_proj(p1 + rr2 * 4.0, dd, kk) * to_uv), vec3<f32>(1.3)) * 0.85 + vec3<f32>(0.12, 0.2, 0.24) * max(rr2.y, 0.0);
            sph = mix(sph, refl, ff * fade);
            let spec = pow(max(dot(rr2, normalize(vec3<f32>(-0.25, 1.0, 0.15))), 0.0), 140.0) + 0.5 * pow(max(dot(rr2, normalize(vec3<f32>(0.3, 1.0, -0.3))), 0.0), 220.0);
            sph += vec3<f32>(1.0) * spec * 2.2 * fade;
            sph += vec3<f32>(0.22, 0.7, 1.0) * pow(fres, 3.0) * 0.45 * fade;
            col = mix(col, sph, smoothstep(1.0, 0.985, x));
        }
    }
    return vec4<f32>(col, 1.0);
}
