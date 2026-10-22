// Rocha fundida (lava.js): crosta escura (Voronoi) numa correnteza lenta, frestas incandescentes,
// poças que borbulham e relevo; a cor segue a temperatura (o bloom pega o mais quente).

import bevy_pbr::render::{
    pbr_fragment::pbr_input_from_standard_material,
    pbr_functions::alpha_discard,
};
import bevy_pbr::render::{
    forward_io::{VertexOutput, FragmentOutput},
    pbr_functions::{apply_pbr_lighting, main_pass_post_lighting_processing},
};

struct LavaU {
    time: f32,
    _a: f32,
    _b: f32,
    _c: f32,
};

@group(constants::MATERIAL_BIND_GROUP) @binding(100) var<uniform> lava: LavaU;

fn l_hash(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn l_hash2(p: vec2<f32>) -> vec2<f32> {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
fn l_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(l_hash(i), l_hash(i + vec2<f32>(1.0, 0.0)), u.x), mix(l_hash(i + vec2<f32>(0.0, 1.0)), l_hash(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn l_fbm(p0: vec2<f32>) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var p = p0;
    for (var i = 0; i < 5; i++) {
        s += a * l_noise(p);
        p = mat2x2<f32>(1.6, 1.2, -1.2, 1.6) * p;
        a *= 0.5;
    }
    return s;
}
// (distância ao centro da placa, distância até a borda, sorteio da placa)
fn l_voro(p: vec2<f32>, t: f32) -> vec3<f32> {
    let i = floor(p);
    let f = fract(p);
    var d1 = 8.0;
    var d2 = 8.0;
    var id = 0.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let g = vec2<f32>(f32(x), f32(y));
            var o = l_hash2(i + g);
            o = 0.5 + 0.4 * sin(t * 0.2 + 6.2831 * o);
            let r = g + o - f;
            let d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; id = l_hash(i + g); } else if (d < d2) { d2 = d; }
        }
    }
    d1 = sqrt(d1);
    return vec3<f32>(d1, sqrt(d2) - d1, id);
}
fn l_heat_color(t: f32) -> vec3<f32> {
    var c = mix(vec3<f32>(0.22, 0.015, 0.0), vec3<f32>(1.0, 0.16, 0.0), smoothstep(0.0, 0.45, t));
    c = mix(c, vec3<f32>(1.0, 0.5, 0.06), smoothstep(0.4, 0.75, t));
    return mix(c, vec3<f32>(1.0, 0.88, 0.55), smoothstep(0.82, 1.0, t));
}

struct Heat { t: f32, height: f32, grain: f32 };

fn lava_heat(w: vec3<f32>, nrm: vec3<f32>) -> Heat {
    let an = abs(nrm);
    var p2 = w.xy;
    if (an.y > 0.5) { p2 = w.xz; } else if (an.x > an.z) { p2 = w.zy; }
    let p = p2 * 0.55;
    let t = lava.time;
    let flow = vec2<f32>(t * 0.035, t * 0.022);
    let ww = vec2<f32>(l_fbm(p * 0.6 + flow), l_fbm(p * 0.6 - flow + 7.3));
    let q = p + (ww - 0.5) * 1.4 + flow * 0.5;
    let v = l_voro(q, t);
    let n = l_fbm(q * 3.0);
    let aa = fwidth(v.y) * 1.5;
    let crack = 1.0 - smoothstep(0.01, 0.035 + 0.09 * n * n + 0.04 * v.z + aa, v.y);
    let pool = smoothstep(0.6, 0.8, l_fbm(p * 0.22 + vec2<f32>(-t * 0.01, t * 0.008) + 3.1));
    var T = max(crack * (0.72 + 0.28 * n), pool * (0.78 + 0.22 * l_fbm(q * 1.5 + t * 0.1)));
    T = max(T, (1.0 - smoothstep(0.0, 0.16, v.y)) * 0.3 * (1.0 - 0.7 * v.z));
    // bolhas nas poças
    let bc = p * 1.3;
    let bi = floor(bc);
    let bf = fract(bc) - 0.5 - (l_hash2(bi + 3.0) - 0.5) * 0.5;
    let bh = l_hash(bi + 17.0);
    let ph = fract(t * 0.13 + bh * 7.0);
    let bd = length(bf);
    let r = ph * 0.3;
    let live = step(0.45, bh) * pool;
    let dome = (1.0 - smoothstep(r - 0.03, r, bd)) * step(ph, 0.9);
    let ring = (1.0 - smoothstep(0.0, 0.035, abs(bd - r))) * step(ph, 0.9);
    let pop = (1.0 - smoothstep(0.0, 0.22, bd)) * smoothstep(0.9, 0.92, ph) * (1.0 - smoothstep(0.93, 1.0, ph));
    T = mix(T, T * 0.55, dome * live) + (ring * 0.35 + pop * 0.8) * live;
    let far = clamp(length(fwidth(q)) * 6.0 - 0.3, 0.0, 1.0);
    T = mix(T, 0.22 + 0.3 * pool, far);
    T = clamp(T * (0.93 + 0.07 * sin(t * 1.7 + n * 6.0)), 0.0, 1.0);
    var h: Heat;
    h.t = T;
    h.height = (1.0 - T) * 0.7 + n * 0.3;
    h.grain = n;
    return h;
}

@fragment
fn fragment(in: VertexOutput, @builtin(front_facing) is_front: bool) -> FragmentOutput {
    var pbr_input = pbr_input_from_standard_material(in, is_front);
    let w = in.world_position.xyz;
    let h = lava_heat(w, normalize(in.world_normal));
    pbr_input.material.base_color = vec4<f32>(mix(vec3<f32>(0.03, 0.022, 0.02) * (0.4 + 1.1 * h.grain), vec3<f32>(0.3, 0.06, 0.01), smoothstep(0.2, 0.7, h.t)), 1.0);
    pbr_input.material.perceptual_roughness = mix(0.95, 0.38, h.t);
    // relevo pela derivada da altura (a crosta fica acima da lava exposta)
    let sx = dpdx(w);
    let sy = dpdy(w);
    let nn = pbr_input.N;
    let r1 = cross(sy, nn);
    let r2 = cross(nn, sx);
    let det = dot(sx, r1);
    let hs = 0.12 * h.height;
    let grad = sign(det) * (dpdx(hs) * r1 + dpdy(hs) * r2);
    pbr_input.N = normalize(abs(det) * nn - grad);
    pbr_input.material.emissive = vec4<f32>(l_heat_color(h.t) * (pow(h.t, 2.2) * 3.6 + 0.012), 1.0);
    var out: FragmentOutput;
    out.color = apply_pbr_lighting(pbr_input);
    out.color = main_pass_post_lighting_processing(pbr_input, out.color);
    return out;
}
