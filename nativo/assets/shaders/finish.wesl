// Acabamento (FinishPass da versão web), depois do tom: aberração cromática, vinheta, grão de
// filme, o gelo do tempo parado, o "glitch" do paradoxo e o visual do tempo lento (o filtro da tela:
// menos saturação, mais contraste, um puxão para o azul, as linhas e a borda azul).

import bevy_core_pipeline::fullscreen_vertex_shader::FullscreenVertexOutput;

struct FinishFx {
    a: vec4<f32>,
    b: vec4<f32>,
};

@group(0) @binding(0) var screen: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> fx: FinishFx;

fn to_srgb(c: vec3<f32>) -> vec3<f32> {
    let x = max(c, vec3<f32>(0.0));
    return select(1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3<f32>(0.0031308));
}
fn to_lin(c: vec3<f32>) -> vec3<f32> {
    let x = max(c, vec3<f32>(0.0));
    return select(pow((x + 0.055) / 1.055, vec3<f32>(2.4)), x / 12.92, x <= vec3<f32>(0.04045));
}
fn grade(uv: vec2<f32>) -> vec3<f32> {
    return to_srgb(textureSampleLevel(screen, samp, uv, 0.0).rgb);
}

@fragment
fn fragment(in: FullscreenVertexOutput) -> @location(0) vec4<f32> {
    var uv = in.uv;
    let t = fx.a.x;
    let aberr = fx.a.y;
    let vig = fx.a.z;
    let grain = fx.a.w;
    let freeze = fx.b.x;
    let glitch = fx.b.y;
    let slow = fx.b.z;
    let size = vec2<f32>(textureDimensions(screen));
    let frag = in.position.xy;
    // paradoxo: faixas horizontais da imagem deslizam de lado
    if (glitch > 0.001) {
        let band = floor((1.0 - uv.y) * 26.0 + floor(t * 24.0));
        let rnd = fract(sin(band * 91.7 + floor(t * 24.0) * 7.3) * 437.5);
        uv.x += (rnd - 0.5) * 0.10 * glitch * step(0.62, rnd);
    }
    let d = uv - 0.5;
    let r2 = dot(d, d);
    let off = d * r2 * aberr * 8.0 + vec2<f32>(glitch * 0.012, 0.0);
    var c = grade(uv);
    if (aberr > 1e-5 || glitch > 0.001) {
        c = vec3<f32>(grade(uv + off).r, c.g, grade(uv - off).b);
    }
    // tempo parado: o mundo perde a cor e fica azul-gelo, com a borda congelada
    if (freeze > 0.001) {
        let l = dot(c, vec3<f32>(0.3, 0.59, 0.11));
        c = mix(c, vec3<f32>(l) * vec3<f32>(0.80, 0.95, 1.15), freeze * 0.78);
        c += vec3<f32>(0.0, 0.05, 0.12) * freeze * smoothstep(0.15, 1.0, r2 * 2.2);
        c *= 1.0 + 0.06 * freeze * sin((size.y - frag.y) * 1.8);
    }
    // tempo lento: o filtro da tela (saturate .35, contrast 1.12, brightness .96, hue −10°)
    if (slow > 0.001) {
        var s = c;
        let l = dot(s, vec3<f32>(0.2126, 0.7152, 0.0722));
        s = mix(vec3<f32>(l), s, 0.35);
        s = (s - 0.5) * 1.12 + 0.5;
        s *= 0.96;
        let a = -10.0 * 3.14159265 / 180.0;
        let ca = cos(a);
        let sa = sin(a);
        let m = mat3x3<f32>(
            vec3<f32>(0.213 + ca * 0.787 - sa * 0.213, 0.213 - ca * 0.213 + sa * 0.143, 0.213 - ca * 0.213 - sa * 0.787),
            vec3<f32>(0.715 - ca * 0.715 - sa * 0.715, 0.715 + ca * 0.285 + sa * 0.140, 0.715 - ca * 0.715 + sa * 0.715),
            vec3<f32>(0.072 - ca * 0.072 + sa * 0.928, 0.072 - ca * 0.072 - sa * 0.283, 0.072 + ca * 0.928 + sa * 0.072),
        );
        s = m * s;
        // borda azul e linhas (mistura "screen")
        let e = smoothstep(0.42, 1.0, sqrt(r2 * 2.0)) * 0.38;
        let line = select(0.0, 0.035, ((size.y - frag.y) % 3.0) < 1.0);
        let over = vec3<f32>(0.118, 0.353, 0.745) * e + vec3<f32>(0.63, 0.86, 1.0) * line;
        s = 1.0 - (1.0 - s) * (1.0 - over);
        c = mix(c, s, slow);
    }
    c *= 1.0 - vig * smoothstep(0.1, 1.0, r2 * 2.0);
    let n = fract(sin(dot(frag + fract(t * 7.31) * 113.0, vec2<f32>(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) * grain;
    return vec4<f32>(to_lin(c), 1.0);
}
