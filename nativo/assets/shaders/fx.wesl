// Efeitos do jogo (portados dos ShaderMaterial da versão web). `fx.kind` escolhe o efeito.
// Partículas: 4 vértices por partícula, semente em `color`, canto (−1..1) em `uv`.

import bevy_pbr::render::{
    mesh_functions,
    mesh_view_bindings::view,
    view_transformations::position_world_to_clip,
};

struct FxU {
    color: vec4<f32>,
    p0: vec4<f32>,
    p1: vec4<f32>,
    p2: vec4<f32>,
    p3: vec4<f32>,
    time: f32,
    kind: u32,
    flags: u32,
    size: f32,
};

@group(constants::MATERIAL_BIND_GROUP) @binding(0) var<uniform> fx: FxU;
@group(constants::MATERIAL_BIND_GROUP) @binding(1) var fx_tex: texture_2d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(2) var fx_samp: sampler;

const FIZZ_FIELD: u32 = 1u;
const COIL: u32 = 2u;
const SLIT: u32 = 3u;
const FIZZ_MOTES: u32 = 4u;
const GRAV_ZONE: u32 = 5u;
const BH_HALO: u32 = 6u;
const BH_DISK: u32 = 7u;
const BH_MOTES: u32 = 8u;
const EMBERS: u32 = 9u;
const ELEV_MOTES: u32 = 10u;
const STARS: u32 = 11u;
const SPRITE: u32 = 12u;
const HINT: u32 = 13u;
const HOLO: u32 = 14u;
const PORTAL_VIEW: u32 = 20u;
const PORTAL_RIM: u32 = 21u;
const PORTAL_GLOW: u32 = 22u;
const PORTAL_SPARKS: u32 = 23u;
const LASER_GLOW: u32 = 30u;
const FUNNEL: u32 = 31u;
const BRIDGE: u32 = 32u;
const BRIDGE_CORNER: u32 = 33u;
const GUN_PLASMA: u32 = 34u;
const GUN_CONDUIT: u32 = 35u;
const GUN_MOTES: u32 = 36u;
const VEIN: u32 = 37u;
const DISSOLVE: u32 = 38u;
const DUST: u32 = 39u;

fn dh3(p: vec3<f32>) -> f32 { return fract(sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453); }
fn dn3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dh3(i), dh3(i + vec3<f32>(1.0, 0.0, 0.0)), f.x), mix(dh3(i + vec3<f32>(0.0, 1.0, 0.0)), dh3(i + vec3<f32>(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(dh3(i + vec3<f32>(0.0, 0.0, 1.0)), dh3(i + vec3<f32>(1.0, 0.0, 1.0)), f.x), mix(dh3(i + vec3<f32>(0.0, 1.0, 1.0)), dh3(i + vec3<f32>(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
const BRIDGE_W: f32 = 2.0;
const PORTAL_A: f32 = 0.68;
const PORTAL_B: f32 = 1.08;
const RIM: f32 = 1.42;
const GLOW: f32 = 2.3;

@group(constants::MATERIAL_BIND_GROUP) @binding(3) var fx_view: texture_2d<f32>;
@group(constants::MATERIAL_BIND_GROUP) @binding(4) var fx_view_samp: sampler;

struct Vertex {
    @builtin(instance_index) instance_index: u32,
    @location(0) position: vec3<f32>,
    @if(VERTEX_NORMALS)
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @if(VERTEX_COLORS)
    @location(5) color: vec4<f32>,
};

struct Out {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) local: vec3<f32>,
    // partículas: alfa, calor e cor
    @location(3) a: vec4<f32>,
    // normal no mundo e comprimento ao longo do eixo y do objeto (feixes, funis, pontes)
    @location(4) nrm: vec4<f32>,
};

fn h1(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }
fn h41(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(41.3, 289.1))) * 43758.5); }
fn n2(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h1(i), h1(i + vec2<f32>(1.0, 0.0)), f.x), mix(h1(i + vec2<f32>(0.0, 1.0)), h1(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}
fn n41(p: vec2<f32>) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h41(i), h41(i + vec2<f32>(1.0, 0.0)), f.x), mix(h41(i + vec2<f32>(0.0, 1.0)), h41(i + vec2<f32>(1.0, 1.0)), f.x), f.y);
}
fn fbm(p0: vec2<f32>) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var p = p0;
    for (var i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.1 + 3.7; a *= 0.5; }
    return s;
}
// o ruído dos portais (portals.js: NOISE)
fn fbm41(p0: vec2<f32>) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var p = p0;
    for (var i = 0; i < 4; i++) { s += a * n41(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return s;
}
fn h3(p: vec3<f32>) -> f32 { return fract(sin(dot(p, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453); }
fn modf_(x: vec2<f32>, y: vec2<f32>) -> vec2<f32> { return x - y * floor(x / y); }

// distância à borda da célula hexagonal
fn hex_edge(p: vec2<f32>) -> f32 {
    let r = vec2<f32>(1.0, 1.7320508);
    let a = modf_(p, r) - r * 0.5;
    let b = modf_(p - r * 0.5, r) - r * 0.5;
    var q = a;
    if (dot(a, a) >= dot(b, b)) { q = b; }
    q = abs(q);
    return 0.5 - max(dot(q, vec2<f32>(0.5, 0.8660254)), q.x);
}

/// partícula: posição no espaço do objeto a partir da semente (e o alfa, calor...)
fn particle(kind: u32, base: vec3<f32>, s: vec4<f32>, t: f32) -> mat2x4<f32> {
    var p = base;
    var a = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    var size = fx.size;
    if (kind == FIZZ_MOTES) {
        // faíscas soltas subindo junto à grade (p0.xy = tamanho do campo)
        let life = fract(t * (0.08 + s.z * 0.12) + s.y);
        p = vec3<f32>((s.x - 0.5) * fx.p0.x, (life - 0.5) * fx.p0.y, (s.z - 0.5) * 0.12);
        p.x += sin(t * 2.0 + s.y * 20.0) * 0.05;
        a.x = sin(life * 3.14159) * (0.4 + 0.6 * step(0.7, fract(s.x * 13.0 + t * 3.0)));
    } else if (kind == BH_MOTES) {
        let life = fract(t * (0.05 + s.x * 0.08) + s.y);
        let r = mix(fx.p0.y, fx.p0.x, life * life);
        let ang = s.z * 6.2831 + t * (0.6 + 3.0 / r) * (1.0 + life * 2.0);
        p = vec3<f32>(cos(ang) * r, (s.x - 0.5) * r * 0.25 * (1.0 - life), sin(ang) * r);
        a.x = sin(life * 3.14159);
    } else if (kind == EMBERS) {
        let life = 2.5 + s.y * 3.5;
        let ph = fract(t / life + s.x);
        p.y += ph * (1.5 + s.z * 4.5);
        p.x += sin(t * 0.9 + s.w * 20.0) * 0.5 * ph;
        p.z += cos(t * 0.7 + s.x * 20.0) * 0.5 * ph;
        a.x = (1.0 - ph) * smoothstep(0.0, 0.06, ph) * (0.6 + 0.4 * sin(t * 12.0 + s.w * 40.0));
        a.y = 1.0 - ph;
        size = (0.035 + 0.05 * s.w) * 1.8;
    } else if (kind == ELEV_MOTES) {
        // p0.x = 1 ou −1 (elevador virado)
        let ang = s.x * 6.2831853 + t * 0.3;
        let r = 0.3 + s.y * 0.85;
        let yy = (((s.z * 3.0 + t * (0.4 + s.y * 0.5)) % 3.0) + 0.2) * fx.p0.x;
        p = vec3<f32>(cos(ang) * r, yy, sin(ang) * r);
    } else if (kind == STARS) {
        a = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    } else if (kind == GUN_MOTES) {
        // partículas de energia na frente da boca da arma (p0.x = espalhamento)
        let seed = s.x;
        let sp = 1.5 + 2.5 * fract(seed * 7.7);
        let ang = seed * 6.2831853 * 13.0 + t * sp;
        let r = 0.05 + 0.05 * fract(seed * 3.1) + fx.p0.x * 0.03;
        let z = -0.36 - 0.12 * fract(seed * 5.3 + t * 0.3 * sp);
        p = vec3<f32>(cos(ang) * r, sin(ang) * r, z);
        size = 0.003 + 0.003 * fract(seed * 9.1);
        a.x = (0.5 + 0.5 * sin(t * 9.0 + seed * 40.0)) * (0.3 + fx.p0.x * 0.7);
    } else if (kind == DUST) {
        // poeira no ar: um cubo de 14 m que acompanha a câmera (p0.xyz), deriva devagar
        let sz = fx.p0.w;
        let cam = fx.p0.xyz;
        let drift = vec3<f32>(sin(t * 0.13 + s.w * 6.28) * 0.6, -0.05 * t * (0.3 + s.w), cos(t * 0.11 + s.x * 6.28) * 0.6);
        p = s.xyz * sz + drift;
        p = (p - cam + sz * 0.5) - sz * floor((p - cam + sz * 0.5) / sz) + cam - sz * 0.5;
        size = 0.012 + 0.012 * s.w;
        // some perto da borda do cubo e muito perto da câmera
        let rel = abs(p - cam) / (sz * 0.5);
        let d = length(p - cam);
        a.x = (1.0 - smoothstep(0.7, 1.0, max(rel.x, max(rel.y, rel.z)))) * smoothstep(0.3, 1.2, d) * (0.25 + 0.35 * s.y);
    } else if (kind == PORTAL_SPARKS) {
        // faíscas que escapam da borda (p0 = meia largura, meia altura, abertura)
        let seed = s.x;
        let open = fx.p0.z;
        let speed = 0.35 + 0.45 * fract(seed * 7.13);
        let life = fract(t * speed + seed * 3.7);
        let ang = seed * 6.2831853 * 17.0 + life * (fract(seed * 5.3) - 0.5) * 1.2;
        let rr = (1.0 + life * (0.18 + 0.3 * fract(seed * 2.9))) * open;
        p = vec3<f32>(cos(ang) * fx.p0.x * rr, sin(ang) * fx.p0.y * rr, 0.02 + life * 0.35 * fract(seed * 9.1));
        p.y -= life * life * 0.25;
        size = fx.size * (1.0 - 0.6 * life);
        a.x = (1.0 - life) * smoothstep(0.0, 0.08, life) * open;
    }
    return mat2x4<f32>(vec4<f32>(p, size), a);
}

@vertex
fn vertex(v: Vertex) -> Out {
    var out: Out;
    let world_from_local = mesh_functions::get_world_from_local(v.instance_index);
    out.uv = v.uv;
    out.local = v.position;
    out.a = vec4<f32>(1.0, 0.0, 0.0, 0.0);
    out.nrm = vec4<f32>(0.0, 1.0, 0.0, v.position.y * length(world_from_local[1].xyz));
@if(VERTEX_NORMALS) {
    out.nrm = vec4<f32>(normalize(mat3x3<f32>(world_from_local[0].xyz, world_from_local[1].xyz, world_from_local[2].xyz) * v.normal), out.nrm.w);
}
@if(VERTEX_COLORS) {
    if (fx.kind == VEIN) {
        // veia do chefe: a cor do vértice traz o centro do tubo (xyz) e a semente (w); o tubo
        // inteiro ondula (p0.x = amplitude, p0.y = raiva), mais forte longe da raiz
        let c = v.color.xyz;
        let ph = v.color.w * 6.2831853;
        let t = fx.time;
        let off = vec3<f32>(sin(t * 2.1 + ph + c.y * 0.35), sin(t * 1.7 + ph * 1.3 + c.z * 0.3 + c.x * 0.2), cos(t * 2.4 + ph * 0.7 + c.x * 0.3));
        let p = v.position + off * fx.p0.x * fx.p0.y * smoothstep(0.0, 0.45, v.uv.x);
        let w = (world_from_local * vec4<f32>(p, 1.0)).xyz;
        out.world = w;
        out.clip = position_world_to_clip(w);
        out.a = vec4<f32>(v.color.w, 0.0, 0.0, 0.0);
        return out;
    }
    // partícula virada para a câmera
    let pr = particle(fx.kind, v.position, v.color, fx.time);
    let center = (world_from_local * vec4<f32>(pr[0].xyz, 1.0)).xyz;
    var mv = view.view_from_world * vec4<f32>(center, 1.0);
    mv = vec4<f32>(mv.xy + v.uv * pr[0].w * 0.5, mv.zw);
    out.clip = view.clip_from_view * mv;
    out.world = center;
    out.a = pr[1];
    if (fx.kind == STARS) { out.a = vec4<f32>(1.0, v.color.xyz); }
    return out;
}
    var world = (world_from_local * vec4<f32>(v.position, 1.0)).xyz;
    if (fx.kind == BH_HALO || fx.kind == SPRITE) {
        // plano sempre virado para a câmera (centro na origem do objeto)
        let c = (world_from_local * vec4<f32>(0.0, 0.0, 0.0, 1.0)).xyz;
        var mv = view.view_from_world * vec4<f32>(c, 1.0);
        let sx = length(world_from_local[0].xyz);
        mv = vec4<f32>(mv.xy + v.position.xy * sx, mv.zw);
        out.clip = view.clip_from_view * mv;
        out.world = c;
        return out;
    }
    if (fx.kind == BRIDGE) {
        // a direção da câmera no espaço da ponte (x de lado, y ao longo, z normal): paralaxe
        let vv = normalize(view.world_position - world);
        let bx = world_from_local[0].xyz;
        let by = world_from_local[1].xyz;
        let bz = world_from_local[2].xyz;
        out.a = vec4<f32>(dot(vv, bx / max(length(bx), 1e-6)), dot(vv, by / max(length(by), 1e-6)), dot(vv, bz / max(length(bz), 1e-6)), 0.0);
    }
    out.world = world;
    out.clip = position_world_to_clip(world);
    return out;
}

@fragment
fn fragment(in: Out, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let c = shade(in, front);
    @if(FX_ADD) {
        return vec4<f32>(c.rgb * clamp(c.a, 0.0, 1.0), 0.0);
    }
    return c;
}

fn shade(in: Out, front: bool) -> vec4<f32> {
    let t = fx.time;
    let k = fx.kind;
    if (k == FIZZ_FIELD) {
        // malha hexagonal, fluxo de ruído subindo, varredura, arcos junto aos emissores, faíscas e onda
        let size = fx.p0.xy;
        let p = in.uv * size;
        let blue = vec3<f32>(0.35, 0.75, 1.0);
        let flow = fbm(vec2<f32>(p.x * 1.6, p.y * 0.9 - t * 0.8));
        var a = 0.05 + 0.16 * smoothstep(0.35, 0.9, flow);
        let hx = 1.0 - smoothstep(0.0, 0.035, hex_edge(p * 2.2 + vec2<f32>(0.0, t * 0.15)));
        a += hx * (0.06 + 0.25 * flow);
        a += pow(abs(sin(p.x * 22.0 + t * 3.0 + sin(p.y * 1.5) * 2.0)), 80.0) * 0.25;
        let sweep = fract(t * 0.35);
        // (o uv do plano do three.js tem v para cima; o daqui também)
        a += exp(-pow((in.uv.y - (1.0 - sweep)) * size.y * 3.0, 2.0)) * 0.55;
        let edge = min(in.uv.x, 1.0 - in.uv.x) * size.x;
        let arcN = fbm(vec2<f32>(p.y * 3.0, t * 6.0 + step(0.5, in.uv.x) * 10.0));
        let arc = smoothstep(0.06, 0.0, abs(edge - arcN * 0.5)) * step(edge, 0.6);
        a += arc * 1.2 + smoothstep(0.35, 0.0, edge) * 0.3;
        let sp = p * vec2<f32>(10.0, 10.0) + vec2<f32>(0.0, t * 5.0);
        let cell = floor(sp);
        let spark = step(0.988, h1(cell)) * (0.5 + 0.5 * sin(t * 25.0 + h1(cell) * 6.28)) * smoothstep(0.22, 0.0, length(fract(sp) - 0.5));
        a += spark;
        let age = t - fx.p1.z;
        if (age < 1.5) {
            let d = length((in.uv - fx.p1.xy) * size);
            a += exp(-pow((d - age * 6.0) * 2.5, 2.0)) * (1.5 - age) * 1.4;
        }
        let col = blue * (1.0 + spark * 2.0 + arc * 1.5);
        return vec4<f32>(col, clamp(a, 0.0, 0.95) * fx.p1.w);
    }
    if (k == COIL) {
        let wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(in.world.y * 3.0 - t * 7.0), 6.0);
        return vec4<f32>(vec3<f32>(0.5, 1.2, 2.6) * wave * (0.12 + 0.88 * fx.p0.x), 1.0);
    }
    if (k == SLIT) {
        let flick = 0.8 + 0.2 * fract(sin((floor(t * 30.0) + floor(in.world.y * 6.0)) * 91.7) * 43758.5);
        let band = 0.6 + 0.4 * sin(in.world.y * 11.0 + t * 9.0);
        return vec4<f32>(vec3<f32>(0.7, 1.6, 3.0) * flick * band * (0.08 + 0.92 * fx.p0.x), 1.0);
    }
    if (k == GRAV_ZONE) {
        let dir = fx.p0.xyz;
        var axis = vec3<f32>(0.0, 1.0, 0.0);
        var speed = 0.15;
        if (length(dir) > 0.5) { axis = dir; speed = 1.2; }
        let along = dot(in.world, axis);
        let bands = pow(0.5 + 0.5 * sin(along * 3.0 - t * speed * 6.0), 8.0);
        let cell = floor(in.world * 2.0);
        let twinkle = step(0.97, h3(cell)) * (0.5 + 0.5 * sin(t * 4.0 + h3(cell) * 30.0));
        let a = 0.05 + bands * 0.12 + twinkle * 0.25;
        return vec4<f32>(fx.color.rgb * 1.6, a);
    }
    if (k == BH_HALO) {
        let p = (in.uv - 0.5) * 7.0;
        let r = length(p);
        let ring = exp(-pow((r - 1.35) * 6.0, 2.0)) * 1.6;
        let glow = exp(-(r - 1.0) * 1.2) * 0.35 * step(1.0, r);
        let ang = atan2(p.y, p.x);
        let flick = 0.85 + 0.15 * sin(ang * 7.0 + t * 3.0);
        let col = vec3<f32>(1.0, 0.75, 0.45) * ring * flick + vec3<f32>(0.6, 0.35, 1.0) * glow;
        return vec4<f32>(col, clamp(ring + glow, 0.0, 1.0) * step(1.0, r));
    }
    if (k == BH_DISK) {
        let vp = in.local.xy;
        let r = length(vp);
        let kk = (r - fx.p0.x) / (fx.p0.y - fx.p0.x);
        let ang = atan2(vp.y, vp.x);
        let swirl = ang + t * (2.4 / (0.4 + kk * 3.0)) - log(r) * 3.0;
        let n = n41(vec2<f32>(swirl * 3.0, r * 2.0)) * 0.6 + n41(vec2<f32>(swirl * 9.0, r * 6.0)) * 0.4;
        let hot = mix(vec3<f32>(3.0, 2.4, 1.6), vec3<f32>(2.2, 0.6, 0.15), smoothstep(0.0, 0.7, kk));
        let alpha = (1.0 - smoothstep(0.6, 1.0, kk)) * smoothstep(0.0, 0.05, kk) * (0.35 + 0.65 * n);
        return vec4<f32>(hot * (0.6 + 0.8 * n), alpha);
    }
    if (k == SPRITE) {
        // brilho redondo (glowTexture / haloTexture): cor × degradê radial
        let r = length(in.uv - 0.5) * 2.0;
        var a = 0.0;
        if (fx.p0.x > 0.5) {
            // halo (começa em 20/64 do raio)
            a = mix(0.8, 0.25, smoothstep(0.3125, 0.55, r)) * (1.0 - smoothstep(0.55, 1.0, r)) * step(0.3125, r) + 0.8 * (1.0 - step(0.3125, r));
        } else {
            a = mix(1.0, 0.45, smoothstep(0.0, 0.25, r)) * (1.0 - smoothstep(0.25, 1.0, r));
        }
        return vec4<f32>(fx.color.rgb, a * fx.color.a);
    }
    if (k == LASER_GLOW) {
        let face = abs(dot(normalize(in.nrm.xyz), normalize(view.world_position - in.world)));
        let flick = 0.85 + 0.15 * sin(in.nrm.w * 30.0 - t * 40.0);
        return vec4<f32>(vec3<f32>(2.6, 0.25, 0.12) * flick, pow(face, 3.0) * 0.8);
    }
    if (k == FUNNEL) {
        // p0.x = sentido (1 ou −1)
        let sg = fx.p0.x;
        let along = in.nrm.w;
        let ang = in.uv.x * 6.2831853;
        let s1 = pow(0.5 + 0.5 * sin(along * 2.4 - t * 5.0 * sg + ang * 2.0), 6.0);
        let s2 = pow(0.5 + 0.5 * sin(along * 0.9 - t * 2.6 * sg - ang * 3.0), 12.0);
        let rings = pow(0.5 + 0.5 * sin(along * 6.0 - t * 9.0 * sg), 30.0);
        let rim = pow(1.0 - abs(dot(normalize(in.nrm.xyz), normalize(view.world_position - in.world))), 2.0);
        let a = 0.05 + 0.22 * s1 + 0.2 * s2 + 0.25 * rings + rim * 0.3;
        return vec4<f32>(fx.color.rgb * (1.0 + s1 + rings), clamp(a, 0.0, 0.9));
    }
    if (k == BRIDGE) {
        return bridge(in);
    }
    if (k == BRIDGE_CORNER) {
        // brilho das quinas: forte de frente, some na silhueta. p0 = (comprimento, fadeA, fadeB, ao longo?)
        let face = clamp(abs(dot(normalize(in.nrm.xyz), normalize(view.world_position - in.world))), 0.0, 1.0);
        let run = 0.8 + 0.2 * sin(dot(in.world, vec3<f32>(1.3, 0.7, 1.1)) * 2.0 - t * 4.0);
        let soft = face * face * (3.0 - 2.0 * face);
        var f = 1.0;
        if (fx.p0.w > 0.5) { f = bridge_fade(in.uv.y * fx.p0.x, fx.p0.x, fx.p0.y, fx.p0.z); }
        return vec4<f32>(fx.color.rgb * soft * soft * 0.9 * run * f, 1.0);
    }
    if (k == GUN_PLASMA) {
        // núcleo de plasma da arma (p0.x = reforço)
        let p = vec2<f32>(in.uv.x * 7.0, in.uv.y * 4.0 - t * 3.2);
        let f = fbm41(p + fbm41(p * 1.7 + t * 0.9));
        let bands = 0.65 + 0.35 * sin(in.uv.y * 34.0 - t * 14.0);
        // fio quente no meio do tubo (quase branco: o brilho da câmera da arma acende em volta)
        let mid = exp(-pow((in.uv.x - 0.5) * 5.0, 2.0));
        let flick = 0.85 + 0.15 * sin(t * 23.0 + in.uv.y * 9.0);
        var col = fx.color.rgb * (0.4 + 2.2 * f * f + fx.p0.x) * bands;
        col += mix(fx.color.rgb, vec3<f32>(1.0), 0.55) * mid * (0.8 + 1.4 * f) * flick * (1.0 + fx.p0.x);
        return vec4<f32>(col, 1.0);
    }
    if (k == DISSOLVE) {
        // objeto que some: buracos de ruído crescendo (p0.x = 0 → 1), borda acesa na cor
        let n = dn3(in.local * 9.0) * 0.65 + dn3(in.local * 23.0) * 0.35;
        let cut = fx.p0.x * 1.1 - 0.05;
        if (n < cut) { discard; }
        let edge = 1.0 - smoothstep(0.0, 0.035, n - cut);
        let nv = normalize((view.view_from_world * vec4<f32>(normalize(in.nrm.xyz), 0.0)).xyz);
        let lit = 0.35 + 0.65 * max(dot(nv, normalize(vec3<f32>(0.3, 0.9, 0.4))), 0.0);
        let base = mix(vec3<f32>(0.5), vec3<f32>(0.04), smoothstep(0.0, 0.25, fx.p0.x)) * lit;
        return vec4<f32>(mix(base, fx.color.rgb * 4.0, edge), 1.0);
    }
    if (k == VEIN) {
        // recua da ponta para a raiz (p0.z), cresce da raiz (p0.w: o feixe calmo), pulsa ao longo
        let along = in.uv.x;
        let seed = in.a.x;
        var keep = 1.0 - fx.p0.z * (0.55 + 0.5 * seed) * 1.6;
        if (fx.p0.z >= 0.999) { keep = -1.0; }
        if (along > keep || along > fx.p0.w) { discard; }
        // (a luz fixa é no espaço da câmera, como no three.js)
        let n = normalize((view.view_from_world * vec4<f32>(normalize(in.nrm.xyz), 0.0)).xyz);
        let vv = normalize((view.view_from_world * vec4<f32>(view.world_position - in.world, 0.0)).xyz);
        let lam = 0.5 + 0.5 * dot(n, normalize(vec3<f32>(0.25, 0.6, 0.75)));
        let rim = pow(1.0 - max(dot(n, vv), 0.0), 2.5);
        let pulse = pow(0.5 + 0.5 * sin(along * 38.0 - t * (2.5 + 7.0 * fx.p0.y) + seed * 9.0), 4.0);
        let base = fx.color.rgb;
        let col = base * (0.3 + 0.7 * lam) + base * pulse * (0.35 + 1.5 * fx.p0.y) + base * rim * 0.6 + vec3<f32>(1.0, 0.95, 0.9) * fx.p1.x * 0.8;
        return vec4<f32>(col, 1.0);
    }
    if (k == GUN_CONDUIT) {
        // filete aceso com um pulso correndo para a frente depois do tiro (p0.x = pulso, < 0 sem)
        let flow = 0.5 + 0.3 * sin(in.uv.x * 46.0 - t * 7.0);
        var pulse = 0.0;
        if (fx.p0.x >= 0.0) { pulse = exp(-pow((in.uv.x - fx.p0.x) * 9.0, 2.0)) * 3.5; }
        let core = mix(fx.color.rgb, vec3<f32>(1.0), 0.35 * pulse / 3.5);
        return vec4<f32>(core * (flow * 1.4 + pulse), 1.0);
    }
    if (k == HOLO) {
        // holograma do passado: azul, mais forte na silhueta, com faixas correndo
        let f = pow(1.0 - max(abs(dot(normalize(in.nrm.xyz), normalize(view.world_position - in.world))), 0.0), 1.7);
        let sc = 0.62 + 0.38 * sin(in.world.y * 16.0 - t * 3.5) * sin(in.world.x * 3.0 + in.world.z * 3.0 + t);
        let col = vec3<f32>(0.25, 0.85, 1.0) * (0.45 + 1.6 * f) * sc;
        return vec4<f32>(col * 1.4, 0.20 + 0.55 * f);
    }
    if (k == HINT) {
        // dica de mira: brilho verde redondo, pulsando devagar
        let r = length(in.uv - 0.5) * 2.0;
        let glow = smoothstep(1.0, 0.0, r);
        let ring = smoothstep(0.08, 0.0, abs(r - 0.62)) * 0.6;
        let a = (glow * glow * 0.32 + ring * 0.35) * (0.75 + 0.25 * sin(t * 2.2));
        return vec4<f32>(vec3<f32>(0.35, 1.6, 0.6) * a, a);
    }
    if (k == PORTAL_VIEW) {
        return portal_view(in);
    }
    if (k == PORTAL_RIM) {
        // anel "queimando" (p0.x = abertura, p0.y = clarão)
        let p = (in.uv - 0.5) * 2.0 * RIM / max(fx.p0.x, 0.001);
        let r = length(p);
        if (r > RIM) { discard; }
        let ang = atan2(p.y, p.x);
        let c = vec2<f32>(cos(ang), sin(ang));
        let slow = fbm41(c * 2.0 + vec2<f32>(t * 0.31, -t * 0.23) + r);
        let fast = fbm41(c * 5.5 + vec2<f32>(-t * 1.1, t * 0.8));
        let d = r - (1.0 + (slow - 0.5) * 0.10);
        let band = smoothstep(-0.26 - 0.10 * fast, -0.03, d) * (1.0 - smoothstep(0.0, 0.03 + 0.06 * fast, d));
        let hot = exp(-abs(d + 0.03) * 30.0);
        let halo = step(0.0, d) * exp(-d * 8.0) * (0.25 + 0.45 * fast);
        let uc = fx.color.rgb;
        var col = uc * (0.42 + 0.75 * fast + 0.5 * hot) + uc * uc * hot * 0.45 + vec3<f32>(hot * hot * 0.35);
        var a = clamp(band * (0.8 + 0.2 * fast) + hot * 0.6 + halo, 0.0, 1.0);
        a *= 1.0 - smoothstep(RIM - 0.08, RIM, r);
        col *= 1.0 * (1.0 + fx.p0.y * 0.5);
        if (a < 0.005) { discard; }
        return vec4<f32>(col, a);
    }
    if (k == PORTAL_GLOW) {
        // aura na parede em volta do portal
        let p = (in.uv - 0.5) * 2.0 * GLOW;
        let open = max(fx.p0.x, 0.001);
        let r = length(p) / open;
        let d = r - 1.0;
        if (d < -0.06) { discard; }
        let ang = atan2(p.y, p.x);
        let c = vec2<f32>(cos(ang), sin(ang));
        let flow = fbm41(c * 3.0 + vec2<f32>(t * 0.55, -t * 0.4) - d * 2.2);
        let wisp = fbm41(c * 7.5 + vec2<f32>(-t * 1.2, t * 0.85) - d * 5.0 + t * 0.7);
        let pulse = 0.82 + 0.18 * sin(t * 2.6 + flow * 2.0);
        let dd = max(d, 0.0);
        let glow = exp(-dd * 3.4) * (0.4 + 0.6 * flow) * pulse;
        let streak = smoothstep(0.52, 0.85, wisp) * exp(-dd * 4.5);
        var a = (glow * 0.28 + streak * 0.45) * smoothstep(-0.06, 0.03, d);
        a *= 1.0 - smoothstep(GLOW - 0.3, GLOW, length(p));
        // clarão da abertura: na versão web o bloom largo espalha o pico (HDR) pela parede; aqui o
        // próprio halo se abre junto, só nos primeiros instantes (cai com o quadrado do clarão)
        let flash = fx.p0.y;
        let f2 = flash * flash;
        a += f2 * exp(-dd * 2.5) * 0.15 * smoothstep(-0.06, 0.03, d) * (1.0 - smoothstep(GLOW - 0.3, GLOW, length(p)));
        a *= min(1.0, fx.p0.x * 1.5);
        let uc = fx.color.rgb;
        let col = uc * uc * (0.95 + 1.0 * streak + flash * 0.3) + uc * streak * 0.25;
        return vec4<f32>(col, min(1.0, a));
    }
@if(VERTEX_COLORS) {
    // partículas: disco macio
    let d = length(in.uv);
    if (d > 1.0) { discard; }
    if (k == FIZZ_MOTES) {
        return vec4<f32>(vec3<f32>(0.7, 1.5, 3.0), in.a.x * (1.0 - d));
    }
    if (k == BH_MOTES) {
        return vec4<f32>(vec3<f32>(2.4, 1.4, 0.7), in.a.x * (1.0 - d));
    }
    if (k == EMBERS) {
        let c = mix(vec3<f32>(1.0, 0.25, 0.02), vec3<f32>(1.0, 0.75, 0.3), in.a.y) * 3.0;
        return vec4<f32>(c, in.a.x * (1.0 - d * d));
    }
    if (k == ELEV_MOTES) {
        return vec4<f32>(fx.color.rgb, fx.color.a);
    }
    if (k == DUST) {
        return vec4<f32>(vec3<f32>(1.0, 0.96, 0.88), in.a.x * (1.0 - d * d));
    }
    if (k == STARS) {
        return vec4<f32>(in.a.yzw, 1.0);
    }
    if (k == GUN_MOTES) {
        return vec4<f32>(fx.color.rgb * 2.2, in.a.x * (1.0 - d));
    }
    if (k == PORTAL_SPARKS) {
        let kk = (1.0 - d) * (1.0 - d);
        return vec4<f32>(fx.color.rgb * 1.6 + 0.6 * kk, in.a.x * kk);
    }
}
    return fx.color;
}

/// a tela do portal (portals.js: displayFS). p0 = centro + abertura, p1 = direita + ligado,
/// p2 = cima + passado, p3 = normal + estática por cima; color.a = só estática
fn portal_view(in: Out) -> vec4<f32> {
    let t = fx.time;
    let cam = view.world_position;
    let center = fx.p0.xyz;
    let right = fx.p1.xyz;
    let up = fx.p2.xyz;
    let normal = fx.p3.xyz;
    let open = fx.p0.w;
    let linked = fx.p1.w;
    let past = fx.p2.w;
    let noise = fx.p3.w;
    let statik = fx.color.a;
    // onde o raio olho → este pixel cruza o plano do portal
    let dir = in.world - cam;
    let denom = dot(dir, normal);
    if (abs(denom) < 1e-6) { discard; }
    let tt = dot(center - cam, normal) / denom;
    let q = cam + dir * tt;
    let pl = vec2<f32>(dot(q - center, right), dot(q - center, up));
    let e = pl / (vec2<f32>(PORTAL_A, PORTAL_B) * max(open, 0.001));
    let r = length(e);
    if (r > 1.0) { discard; }
    let frag = in.clip.xy;
    let suv = (frag - view.viewport.xy) / view.viewport.zw;
    var vw = vec3<f32>(0.0);
    if (statik <= 0.0) { vw = textureSampleLevel(fx_view, fx_view_samp, suv, 0.0).rgb; }
    let lum = dot(vw, vec3<f32>(0.3, 0.59, 0.11));
    vw = mix(vw, vec3<f32>(lum), past);
    if (noise > 0.0) {
        let fy = view.viewport.w - frag.y; // (o gl_FragCoord tem y para cima)
        let px = floor(vec2<f32>(frag.x, fy) / 2.0) % vec2<f32>(512.0);
        let fr = floor(t * 24.0) % 61.0;
        let g = h41(px + fr * vec2<f32>(7.13, 3.71));
        let band = smoothstep(0.6, 1.0, n41(vec2<f32>(fy * 0.02 - t * 3.0, fr * 0.37)));
        let roll = 0.85 + 0.15 * sin(fy * 0.8 + t * 40.0);
        if (statik > 0.0) {
            vw = vec3<f32>(g * roll * (0.55 + 0.35 * band));
        } else {
            vw = mix(vw * roll, vec3<f32>(g), noise * (0.38 + 0.4 * band));
        }
    }
    // sem par: plasma girando na cor do portal
    let uc = fx.color.rgb;
    let ang = t * 0.7 + r * 3.2;
    let sp = mat2x2<f32>(cos(ang), -sin(ang), sin(ang), cos(ang)) * e * 2.4;
    let sw = fbm41(sp + vec2<f32>(t * 0.25, -t * 0.18));
    let swirl = (uc * uc) * (0.25 + 2.4 * sw * sw) * (0.5 + 0.8 * r) + uc * smoothstep(0.55, 1.0, r) * 0.7;
    var col = mix(swirl, vw, linked);
    let edge_n = fbm41(vec2<f32>(atan2(e.y, e.x) * 2.0, t * 0.9));
    col = mix(col, uc * 1.6, smoothstep(0.72, 1.0, r) * 0.45);
    col += uc * exp(-(1.0 - r) * 9.0) * (0.9 + 0.8 * edge_n);
    return vec4<f32>(col, 1.0);
}

// ------------------------------------------------------------------ ponte de luz (frontier.js)
fn bridge_fade(y: f32, len: f32, fa: f32, fb: f32) -> f32 {
    var k = 1.0;
    if (fa > 0.0) { k *= smoothstep(0.0, fa, y); }
    if (fb > 0.0) { k *= smoothstep(0.0, fb, len - y); }
    return k * k * (3.0 - 2.0 * k);
}
fn spow(x: f32, y: f32) -> f32 { return pow(max(x, 0.0), y); }
fn b_h(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn b_h2(p: vec2<f32>) -> vec2<f32> {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}
fn b_n(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(b_h(i), b_h(i + vec2<f32>(1.0, 0.0)), u.x), mix(b_h(i + vec2<f32>(0.0, 1.0)), b_h(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
const B_ROT: mat2x2<f32> = mat2x2<f32>(1.6, 1.2, -1.2, 1.6);
fn b_fbm(p0: vec2<f32>) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var p = p0;
    for (var i = 0; i < 4; i++) { s += a * b_n(p); p = B_ROT * p; a *= 0.5; }
    return s;
}
fn b_ridged(p0: vec2<f32>) -> f32 {
    var s = 0.0;
    var a = 0.55;
    var p = p0;
    for (var i = 0; i < 4; i++) { s += a * (1.0 - abs(b_n(p) * 2.0 - 1.0)); p = B_ROT * p + 3.1; a *= 0.5; }
    return s;
}
fn voro_edge(p: vec2<f32>, t: f32) -> f32 {
    let i = floor(p);
    let f = fract(p);
    var d1 = 8.0;
    var d2 = 8.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let g = vec2<f32>(f32(x), f32(y));
            let o = 0.5 + 0.45 * sin(t + 6.2831 * b_h2(i + g));
            let r = g + o - f;
            let d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
    }
    return sqrt(d2) - sqrt(d1);
}

/// p0 = (comprimento, modelo, fadeA, fadeB); in.a.xyz = câmera no espaço da ponte
fn bridge(in: Out) -> vec4<f32> {
    let len = fx.p0.x;
    let look = i32(fx.p0.y + 0.5);
    let x = (in.uv.x - 0.5) * BRIDGE_W;
    let ax = abs(in.uv.x - 0.5);
    let y = in.uv.y * len;
    let p = vec2<f32>(x, y);
    let t = fx.time;
    let tv = in.a.xyz;
    let par = -tv.xy / max(abs(tv.z), 0.3);
    let wob = (b_fbm(vec2<f32>(y * 0.9 - t * 0.6, 1.7)) - 0.5) * 0.06;
    let rim_o = smoothstep(0.43, 0.5, ax + wob) * (0.55 + 0.45 * b_fbm(vec2<f32>(y * 1.3 - t * 1.6, ax * 9.0)));
    var flick = 1.0;
    var col = vec3<f32>(0.0);
    var a = 0.0;
    if (look == 2) {
        var acc = 0.0;
        var body = 0.0;
        for (var k = 0; k < 3; k++) {
            let h = f32(k) * 0.06;
            let q = (p + par * h) * 0.9;
            let w = vec2<f32>(b_fbm(q + vec2<f32>(0.0, -t * 0.5)), b_fbm(q + vec2<f32>(5.2, 1.3) - t * 0.35));
            let f = b_fbm(q * 1.3 + w * 2.2 - vec2<f32>(0.0, t * 0.8) + f32(k) * 7.0);
            acc += spow(1.0 - abs(f * 2.0 - 1.0), 10.0) * (1.0 - f32(k) * 0.3);
            body += f;
        }
        body /= 3.0;
        col = mix(vec3<f32>(0.02, 0.1, 0.3), vec3<f32>(0.12, 0.42, 0.95), body) + vec3<f32>(0.6, 1.2, 1.9) * acc * 0.9 + vec3<f32>(0.5, 1.1, 1.8) * rim_o;
        a = 0.3 + 0.2 * body + 0.55 * acc + 0.6 * rim_o;
    } else if (look == 3) {
        var acc = 0.0;
        var c = vec3<f32>(0.0);
        for (var k = 0; k < 3; k++) {
            let h = f32(k) * 0.05;
            let q = p + par * h;
            let bend = b_fbm(vec2<f32>(q.y * 0.25 - t * 0.12, f32(k) * 3.0 + t * 0.05)) * 2.4;
            let n = b_fbm(vec2<f32>((q.x + bend) * 2.2, q.y * 0.12 - t * 0.25));
            let curtain = spow(smoothstep(0.35, 0.8, n), 2.0) * (0.75 + 0.25 * sin((q.x + bend) * 38.0 + n * 9.0));
            let hue = b_fbm(vec2<f32>(q.y * 0.08 + t * 0.04, f32(k)));
            c += mix(vec3<f32>(0.1, 1.4, 0.7), vec3<f32>(0.8, 0.35, 1.5), smoothstep(0.35, 0.7, hue)) * curtain * (1.0 - f32(k) * 0.25);
            acc += curtain;
        }
        col = vec3<f32>(0.02, 0.07, 0.08) + c * 1.2 + vec3<f32>(0.4, 1.4, 1.0) * rim_o * 0.8;
        a = 0.22 + 0.4 * acc + 0.5 * rim_o;
    } else if (look == 4) {
        let c1 = voro_edge((p + par * 0.03) * 1.3 + vec2<f32>(0.0, -t * 0.25), t * 0.7);
        let c2 = voro_edge((p + par * 0.09) * 2.1 + vec2<f32>(t * 0.15, t * 0.1), t * 0.9 + 2.0);
        let caus = spow(smoothstep(0.35, 0.0, c1), 3.0) * 0.8 + spow(smoothstep(0.25, 0.0, c2), 3.0) * 0.5;
        let haze = b_fbm(p * 0.7 - t * 0.1);
        col = vec3<f32>(0.12, 0.32, 0.5) * (0.6 + haze) + vec3<f32>(0.8, 1.4, 1.8) * caus + vec3<f32>(0.7, 1.2, 1.6) * rim_o;
        a = 0.32 + 0.12 * haze + 0.45 * caus + 0.55 * rim_o;
    } else if (look == 5) {
        var acc = 0.0;
        for (var k = 0; k < 3; k++) {
            let h = f32(k) * 0.05;
            let q = p + par * h;
            let sp = 1.6 + f32(k) * 0.7;
            let warp = b_fbm(vec2<f32>(q.x * 1.5, q.y * 0.2 - t * 0.3)) * 1.2;
            let n = b_fbm(vec2<f32>((q.x + warp) * 7.0 + f32(k) * 13.0, q.y * 0.35 - t * sp));
            acc += spow(n, 4.0) * 3.0 * (1.0 - f32(k) * 0.25);
        }
        let body_n = b_fbm(vec2<f32>(x * 2.0, y * 0.3 - t));
        col = vec3<f32>(0.08, 0.2, 0.35) * (0.6 + body_n) + vec3<f32>(0.9, 1.25, 1.6) * acc + vec3<f32>(0.8, 1.2, 1.7) * rim_o;
        a = 0.25 + 0.4 * acc + 0.55 * rim_o;
    } else if (look == 6) {
        var dens = 0.0;
        for (var k = 0; k < 4; k++) {
            let h = f32(k) * 0.045;
            let q = (p + par * h) * 1.1;
            let w = vec2<f32>(b_fbm(q * 0.7 + t * 0.12), b_fbm(q * 0.7 - t * 0.1 + 4.0));
            dens += smoothstep(0.35, 0.85, b_fbm(q + w * 1.6 + vec2<f32>(0.0, -t * 0.3) + f32(k) * 2.3)) * 0.35;
        }
        let core = 1.0 - smoothstep(0.15, 0.5, ax + wob);
        dens *= 0.55 + 0.45 * core;
        col = mix(vec3<f32>(0.25, 0.3, 0.55), vec3<f32>(1.1, 1.25, 1.6), dens) + vec3<f32>(0.6, 0.8, 1.4) * rim_o * 0.7;
        a = 0.18 + 0.75 * dens + 0.4 * rim_o;
    } else if (look == 7) {
        let q = p + par * 0.04;
        let r = b_ridged(q * 1.4 + vec2<f32>(0.0, -t * 0.05));
        let vein = spow(smoothstep(0.55, 0.98, r), 3.0);
        let pulse = 0.35 + spow(0.5 + 0.5 * sin(y * 1.6 - t * 3.5 + b_fbm(q * 2.0) * 6.0), 6.0) * 1.6;
        let deep = b_ridged((p + par * 0.12) * 0.8 + 9.0);
        let glow2 = spow(smoothstep(0.6, 1.0, deep), 3.0) * 0.4;
        col = vec3<f32>(0.02, 0.12, 0.12) + vec3<f32>(0.2, 1.5, 1.0) * vein * pulse + vec3<f32>(0.1, 0.6, 0.7) * glow2 + vec3<f32>(0.3, 1.3, 1.0) * rim_o * 0.8;
        a = 0.3 + 0.55 * vein * min(pulse, 1.2) + 0.25 * glow2 + 0.5 * rim_o;
    } else if (look == 1) {
        let n = b_n(p * 1.6 + vec2<f32>(t * 0.15, -t * 0.25)) * 0.6 + b_n(p * 4.0 - t * 0.2) * 0.4;
        let caus = spow(1.0 - abs(n * 2.0 - 1.0), 6.0);
        let rim = smoothstep(0.465, 0.5, ax);
        let seam = smoothstep(0.02, 0.0, abs(fract(y / 2.0) - 0.5) - 0.48);
        col = vec3<f32>(0.75, 0.9, 1.05) * (0.55 + 0.25 * n + 0.6 * caus) + vec3<f32>(1.2, 1.6, 2.0) * (rim + 0.5 * seam);
        a = 0.55 + 0.15 * caus + 0.4 * rim;
    } else {
        let edge = smoothstep(0.42, 0.5, ax);
        let lane = smoothstep(0.03, 0.0, abs(ax - 0.3)) * 0.5;
        let scan = spow(0.5 + 0.5 * sin(y * 2.2 - t * 6.0), 12.0) * 0.35;
        let grid = smoothstep(0.04, 0.0, abs(fract(y * 1.25) - 0.5) - 0.46) * 0.12;
        flick = 0.92 + 0.08 * sin(t * 31.0 + y * 3.0);
        col = vec3<f32>(0.35, 0.85, 1.25) * (0.8 + 1.6 * (edge + lane + scan));
        a = 0.22 + edge * 0.7 + lane + scan + grid;
    }
    if (look >= 2) { a *= 1.0 - smoothstep(0.485, 0.5, ax + wob * 0.5); }
    a *= bridge_fade(y, len, fx.p0.z, fx.p0.w) * (1.0 - smoothstep(0.455, 0.5, ax));
    return vec4<f32>(col * flick, clamp(a * flick, 0.0, 0.95));
}
