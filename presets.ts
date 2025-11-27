

import { Preset } from "./types";

const COMMON_HEADER = `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  dt: f32,
  cameraPos: vec4f,
  mouse: vec4f, // xy = coords, z = click, w = scroll
`;

const COMMON_FOOTER = `
  lightAz: f32,
  lightEl: f32,
  isRendering: f32, // 0=Preview, 1=HQ, 2=Ultra
  aberrationStrength: f32,
  audio: vec4f,
  scrollY: f32, 
  scrollType: f32,
  scrollParam1: f32,
  scrollParam2: f32,
  textureScale: vec2f,
  textureOffset: vec2f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var channel0: texture_2d<f32>;
@group(0) @binding(2) var sampler0: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  output.uv = pos[vertexIndex] * 0.5 + 0.5;
  return output;
}
`;

// --- PBR & MATH LIBRARY ---
const COMMON_FUNCTIONS = `
const PI = 3.14159265359;

// --- NOISE & FBM ---
fn hash(n: f32) -> f32 { return fract(sin(n)*753.5453123); }
fn noise(x: vec3f) -> f32 {
    let p = floor(x);
    let f = fract(x);
    let n = p.x + p.y*157.0 + 113.0*p.z;
    return mix(mix(mix(hash(n+0.0), hash(n+1.0),f.x),
                   mix(hash(n+157.0), hash(n+158.0),f.x),f.y),
               mix(mix(hash(n+113.0), hash(n+114.0),f.x),
                   mix(hash(n+270.0), hash(n+271.0),f.x),f.y),f.z);
}

fn fbm(p: vec3f) -> f32 {
    var f = 0.0;
    var m = mat3x3f(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
    var q = p;
    f += 0.5000*noise(q); q = m*q*2.01;
    f += 0.2500*noise(q); q = m*q*2.02;
    f += 0.1250*noise(q); q = m*q*2.03;
    f += 0.0625*noise(q);
    return f;
}

// --- IMAGE PROCESSING ---
fn getLuma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.299, 0.587, 0.114));
}

fn detectEdge(uv: vec2f) -> f32 {
    let texSize = vec2f(1024.0, 1024.0); // Assumed size
    let w = 1.0 / texSize.x;
    let h = 1.0 / texSize.y;
    
    // Sobel Operator Kernels
    let n00 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f(-w, -h), 0.0).rgb);
    let n10 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f( 0.0, -h), 0.0).rgb);
    let n20 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f( w, -h), 0.0).rgb);
    
    let n01 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f(-w, 0.0), 0.0).rgb);
    let n21 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f( w, 0.0), 0.0).rgb);
    
    let n02 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f(-w, h), 0.0).rgb);
    let n12 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f( 0.0, h), 0.0).rgb);
    let n22 = getLuma(textureSampleLevel(channel0, sampler0, uv + vec2f( w, h), 0.0).rgb);
    
    let sobelX = n00 * -1.0 + n20 * 1.0 + 
                 n01 * -2.0 + n21 * 2.0 + 
                 n02 * -1.0 + n22 * 1.0;
                 
    let sobelY = n00 * -1.0 + n10 * -2.0 + n20 * -1.0 +
                 n02 * 1.0 + n12 * 2.0 + n22 * 1.0;
                 
    return sqrt(sobelX * sobelX + sobelY * sobelY);
}

// --- SDF OPS ---
fn rotate(a: f32) -> mat2x2f {
    let c = cos(a); let s = sin(a);
    return mat2x2f(c, -s, s, c);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdSphere(p: vec3f, s: f32) -> f32 {
  return length(p) - s;
}

fn sdOctahedron(p: vec3f, s: f32) -> f32 {
  let p2 = abs(p);
  return (p2.x + p2.y + p2.z - s) * 0.57735027;
}

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
  let q = vec2f(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

// --- LIGHTING HELPERS ---
fn calcSoftShadow(ro: vec3f, rd: vec3f, tmin: f32, tmax: f32, k: f32) -> f32 {
    var res = 1.0;
    var t = tmin;
    for(var i=0; i<24; i++) {
        let h = map(ro + rd*t);
        res = min(res, k*h/t);
        t += clamp(h, 0.01, 0.2); 
        if(res < 0.01 || t>tmax) { break; }
    }
    return clamp(res, 0.0, 1.0);
}

fn calcAO(pos: vec3f, nor: vec3f) -> f32 {
    var occ = 0.0;
    var sca = 1.0;
    for(var i=0; i<5; i++) {
        let h = 0.01 + 0.12*f32(i)/4.0;
        let d = map(pos + h*nor);
        occ += (h-d)*sca;
        sca *= 0.95;
        if(occ > 0.35) { break; }
    }
    return clamp(1.0 - 3.0*occ, 0.0, 1.0) * (0.5 + 0.5*nor.y);
}

// --- GGX PBR LIGHTING ---
fn DistributionGGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    let num = a2;
    let denom = (NdotH2 * (a2 - 1.0) + 1.0);
    return num / (PI * denom * denom);
}

fn GeometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = (roughness + 1.0);
    let k = (r*r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

fn GeometrySmith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = GeometrySchlickGGX(NdotV, roughness);
    let ggx1 = GeometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn calcIridescence(NdotV: f32) -> vec3f {
    let t = NdotV * 6.0 + 2.0;
    return 0.5 + 0.5 * cos(t + vec3f(0.0, 2.0, 4.0));
}

fn getEnvMap(rd: vec3f) -> vec3f {
    let y = rd.y;
    var col = mix(vec3f(0.02), vec3f(0.1, 0.1, 0.15), smoothstep(-0.2, 0.5, y));
    let softbox = smoothstep(0.8, 1.0, y);
    col += vec3f(4.0) * softbox;
    let keyDir = normalize(vec3f(1.0, 0.5, 0.5));
    let keyDot = max(dot(rd, keyDir), 0.0);
    let lightTex = fbm(rd * 10.0); 
    col += vec3f(6.0, 5.5, 5.0) * pow(keyDot, 30.0) * (0.8 + 0.2 * lightTex);
    let rimDir = normalize(vec3f(-1.0, 0.1, -0.5));
    let rimDot = max(dot(rd, rimDir), 0.0);
    col += vec3f(1.0, 2.0, 4.0) * pow(rimDot, 10.0);
    return col;
}

fn renderPBR(p: vec3f, n: vec3f, v: vec3f, baseColor: vec3f, roughIn: f32, metalIn: f32, shadow: f32, ao: f32) -> vec3f {
    let microNoise = fbm(p * 20.0);
    let roughness = clamp(roughIn + microNoise * 0.1, 0.01, 1.0);
    let metallic = clamp(metalIn - microNoise * 0.05, 0.0, 1.0);

    let l = normalize(vec3f(1.0, 1.0, 1.0)); 
    let h = normalize(v + l);
    
    var F0 = vec3f(0.04); 
    F0 = mix(F0, baseColor, metallic);
    
    let NDF = DistributionGGX(n, h, roughness);   
    let G   = GeometrySmith(n, v, l, roughness);      
    let F   = fresnelSchlick(max(dot(h, v), 0.0), F0);
       
    let numerator    = NDF * G * F; 
    let denominator  = 4.0 * max(dot(n, v), 0.0) * max(dot(n, l), 0.0) + 0.0001; 
    let specular = numerator / denominator;
    
    let kS = F;
    var kD = vec3f(1.0) - kS;
    kD *= 1.0 - metallic;	  
    
    let NdotL = max(dot(n, l), 0.0);                
    let lo = (kD * baseColor / PI + specular) * 5.0 * NdotL * shadow; 
    
    let reflDir = reflect(-v, n);
    let env = getEnvMap(reflDir);
    let diffuseEnv = vec3f(0.03);
    let ambient = (kD * diffuseEnv + env * (1.0 - roughness)) * baseColor * ao;
    
    return lo + ambient;
}

fn gold_noise(xy: vec2f, seed: f32) -> f32 { 
    return fract(tan(distance(xy*1.618, xy)*seed)*xy.x); 
}
`;

const SCROLL_UV_LOGIC = `
    var modUV = uv;
    let sNorm = clamp(u.scrollY, 0.0, 1.0);
    var postFX = vec3f(0.0); 
    
    if (abs(u.scrollType - 4.0) < 0.1) {
        let str = sNorm * u.scrollParam1;
        let n1 = fbm(vec3f(uv * 4.0, u.time * 0.5));
        let dx = (fbm(vec3f((uv + vec2f(0.01,0.)) * 4.0, u.time * 0.5)) - n1) / 0.01;
        let dy = (fbm(vec3f((uv + vec2f(0.,0.01)) * 4.0, u.time * 0.5)) - n1) / 0.01;
        modUV += vec2f(n1, n1) * str * 0.1;
        
        // Caustics
        let light = pow(max(0.0, 1.0 - length(vec2f(dx,dy))), 4.0);
        postFX += vec3f(0.2, 0.8, 1.0) * light * str * 2.0;
    }
    
    if (abs(u.scrollType - 6.0) < 0.1) {
        let p = uv - 0.5;
        let r = length(p);
        let mass = sNorm * u.scrollParam1 * 0.5;
        let rs = 0.1 * mass; 
        
        if (r < rs * 1.5) {
            postFX = vec3f(0.0); // Event horizon
        } else {
            let distortion = rs / r;
            modUV -= p * (distortion * distortion * 12.0); // Gravitational Lensing
            
            // Accretion Disk
            let diskR = r - rs * 2.0;
            let angle = atan2(p.y, p.x);
            let spiral = fbm(vec3f(diskR * 20.0, angle * 5.0 + u.time * 10.0, 0.0));
            let glow = exp(-abs(diskR) * 20.0) * spiral;
            postFX += vec3f(1.0, 0.6, 0.2) * glow * mass * 5.0;
        }
    }
    
    if (abs(u.scrollType - 5.0) < 0.1) {
         let str = sNorm * u.scrollParam1;
         let t = u.time * 20.0;
         let line = floor(uv.y * 100.0);
         let shift = gold_noise(vec2f(line, floor(t)), 1.0);
         if (shift < str) {
             modUV.x += (gold_noise(vec2f(line, t), 2.0) - 0.5) * 0.1;
             postFX += vec3f(0.0, 1.0, 0.0) * 0.2; // Green Phosphor
         }
    }
    
    if (abs(u.scrollType - 2.0) < 0.1) { 
         let center = vec2f(0.5);
         let dir = uv - center;
         let r = length(dir);
         let speed = u.scrollParam1 * sNorm * 8.0;
         modUV -= dir * speed * 0.05 * r;
         
         // Star Streaks
         let a = atan2(dir.y, dir.x);
         let cell = floor(r * 20.0 - u.time * 20.0 * speed);
         let star = gold_noise(vec2f(a * 10.0, cell), 1.0);
         if (star > 0.99) {
             postFX += vec3f(0.8, 0.9, 1.0) * speed * 4.0;
         }
    }
    
    if (abs(u.scrollType - 7.0) < 0.1) {
        let str = sNorm * u.scrollParam1;
        let p = uv - 0.5;
        let r = length(p);
        var a = atan2(p.y, p.x);
        let sides = 6.0;
        let seg = 6.28318 / sides;
        a = abs(fract(a / seg + u.time * 0.1) - 0.5) * seg;
        let uvNew = vec2f(cos(a), sin(a)) * r;
        modUV = mix(uv, uvNew + 0.5, str);
        
        let seam = abs(fract(atan2(p.y, p.x) / seg) - 0.5);
        postFX += vec3f(1.0, 0.5, 0.8) * smoothstep(0.05, 0.0, seam) * str;
    }

    let p = (-u.resolution + 2.0 * modUV * u.resolution) / u.resolution.y;
`;

const PRESET_CHROME = `
${COMMON_HEADER}
  flowSpeed: f32,
  metallic: f32,
  roughness: f32,
  grainStrength: f32,
  baseColor: vec3f,
  _pad_color: f32,
${COMMON_FOOTER}
${COMMON_FUNCTIONS}

fn map(p: vec3f) -> f32 {
    var p2 = p;
    let k = 0.5 + 0.2 * sin(u.time);
    let r = rotate(p.y * 2.0 + u.time * 0.5);
    let rot = r * vec2f(p.x, p.z);
    p2.x = rot.x; p2.z = rot.y;
    let d1 = length(p2) - 1.0;
    let d2 = sdBox(p2, vec3f(0.6)) - 0.2;
    var d = smin(d1, d2, 0.5);
    return d;
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = 0.002;
    return normalize(vec3f(
        map(p + vec3f(e, 0, 0)) - map(p - vec3f(e, 0, 0)),
        map(p + vec3f(0, e, 0)) - map(p - vec3f(0, e, 0)),
        map(p + vec3f(0, 0, e)) - map(p - vec3f(0, 0, e))
    ));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    ${SCROLL_UV_LOGIC}
    
    let ro = vec3f(sin(u.time * 0.2) * 3.0, 0.0, cos(u.time * 0.2) * 3.0);
    let rd = normalize(p.x * normalize(cross(normalize(vec3f(0.0) - ro), vec3f(0.0, 1.0, 0.0))) + p.y * normalize(cross(normalize(cross(normalize(vec3f(0.0) - ro), vec3f(0.0, 1.0, 0.0))), normalize(vec3f(0.0) - ro))) + 1.5 * normalize(vec3f(0.0) - ro));
    
    var t = 0.0;
    var col = getEnvMap(rd) * 0.05; 
    
    for(var i=0; i<128; i++) {
        let d = map(ro + rd * t);
        if(d < 0.002) {
            let pos = ro + rd * t;
            let nor = calcNormal(pos);
            let view = -rd;
            
            // Texture Reflection Mix
            let reflDir = reflect(-view, nor);
            let texXY = (reflDir.xy * 0.5 + 0.5) * u.textureScale + u.textureOffset;
            let texVal = textureSampleLevel(channel0, sampler0, texXY, 0.0).rgb;
            
            let shadow = calcSoftShadow(pos, normalize(vec3f(1.0, 1.0, 1.0)), 0.05, 5.0, 16.0);
            let ao = calcAO(pos, nor);
            
            // Tint reflection with texture
            var albedo = u.baseColor + texVal * 0.2;
            
            col = renderPBR(pos, nor, view, albedo, u.roughness, u.metallic, shadow, ao);
            let iri = calcIridescence(max(dot(nor, view), 0.0));
            col += iri * 0.2 * u.metallic;
            break;
        }
        t += d * 0.8;
    }
    
    col += postFX;
    if (abs(u.scrollType - 6.0) < 0.1 && length(postFX) == 0.0) {
        let center = vec2f(0.5);
        if (length(uv - center) < 0.15 * (u.scrollY * u.scrollParam1 * 0.3 * 5.0)) { col = vec3f(0.0); }
    }
    
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(col, vec3f(1.0/2.2));
    col += (gold_noise(uv * u.resolution, u.time) - 0.5) * u.grainStrength;
    
    return vec4f(col, 1.0);
}
`;

const PRESET_GOLD = `
${COMMON_HEADER}
  waveSpeed: f32,
  metallic: f32,
  roughness: f32,
  grainStrength: f32,
  baseColor: vec3f,
  _pad_color: f32,
${COMMON_FOOTER}
${COMMON_FUNCTIONS}

fn map(p: vec3f) -> f32 {
    let t = u.time * u.waveSpeed;
    // Fluid Motion
    let wave = sin(p.x * 0.5 + t) + sin(p.z * 0.4 + t * 1.2) * 0.8 + sin(p.x * 0.2 + p.z * 0.2) * 0.3;
    return p.y + 2.0 - wave * 0.4;
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = 0.002;
    return normalize(vec3f(
        map(p + vec3f(e, 0, 0)) - map(p - vec3f(e, 0, 0)),
        map(p + vec3f(0, e, 0)) - map(p - vec3f(0, e, 0)),
        map(p + vec3f(0, 0, e)) - map(p - vec3f(0, 0, e))
    ));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    ${SCROLL_UV_LOGIC}

    let ro = vec3f(0.0, 5.0, 0.0);
    let rd = normalize(vec3f(p.x, -1.0, p.y));
    
    var t = 0.0;
    var col = vec3f(0.0);
    
    for(var i=0; i<128; i++) {
        let d = map(ro + rd * t);
        if(d < 0.002) {
            let pos = ro + rd * t;
            var nor = calcNormal(pos);
            
            // --- BUMP MAPPING (MOLD) ---
            // Planar mapping for the fluid surface
            let texUV = (pos.xz * 0.2 + 0.5) * u.textureScale + u.textureOffset; 
            let tex = textureSampleLevel(channel0, sampler0, texUV, 0.0).rgb;
            let texVal = tex.r;
            
            // Perturb normal based on texture gradient (Fake height)
            let e = 0.02;
            let h1 = textureSampleLevel(channel0, sampler0, texUV + vec2f(e, 0.0), 0.0).r;
            let h2 = textureSampleLevel(channel0, sampler0, texUV + vec2f(0.0, e), 0.0).r;
            let bump = vec3f(h1 - texVal, 0.0, h2 - texVal) * 1.5; 
            nor = normalize(nor - bump);
            
            // Modulate material
            var rough = u.roughness;
            var albedo = u.baseColor;
            
            // "Etched" look: stamped areas are rougher and slightly darker
            if (texVal > 0.1) {
                rough = mix(rough, 0.5, texVal);
                albedo = mix(albedo, albedo * 0.5, texVal);
            }

            let shadow = calcSoftShadow(pos, normalize(vec3f(0.5, 1.0, 0.5)), 0.05, 5.0, 4.0);
            let ao = calcAO(pos, nor);
            col = renderPBR(pos, nor, -rd, albedo, rough, u.metallic, shadow, ao);
            col *= 1.5;
            break;
        }
        t += d * 0.6;
    }
    
    col += postFX;
    col = pow(col, vec3f(1.1)); 
    col = col / (col + 0.15);
    col += (gold_noise(uv * u.resolution, u.time) - 0.5) * u.grainStrength;
    return vec4f(col, 1.0);
}
`;

const PRESET_OBSIDIAN = `
${COMMON_HEADER}
  flowSpeed: f32,
  metallic: f32,
  roughness: f32,
  grainStrength: f32,
  baseColor: vec3f,
  _pad_color: f32,
${COMMON_FOOTER}
${COMMON_FUNCTIONS}

fn map(p: vec3f) -> f32 {
    // Infinite Hall of Mirrors
    let z = p.z + u.time * u.flowSpeed;
    
    // Floor
    let dFloor = p.y + 2.0;
    
    // Floating Screens
    let rep = 4.0;
    let zCell = floor(z / rep);
    let zLocal = (fract(z/rep) - 0.5) * rep;
    let xLocal = abs(p.x) - 4.0;
    
    let screen = sdBox(vec3f(xLocal, p.y, zLocal), vec3f(0.1, 1.5, 1.2));
    
    return min(dFloor, screen);
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = 0.002;
    return normalize(vec3f(
        map(p + vec3f(e, 0, 0)) - map(p - vec3f(e, 0, 0)),
        map(p + vec3f(0, e, 0)) - map(p - vec3f(0, e, 0)),
        map(p + vec3f(0, 0, e)) - map(p - vec3f(0, 0, e))
    ));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    ${SCROLL_UV_LOGIC}

    let ro = vec3f(0.0, 0.0, 0.0); 
    let ta = vec3f(0.0, 0.0, 10.0);
    let ww = normalize(ta - ro);
    let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
    let vv = normalize(cross(uu, ww));
    let rd = normalize(p.x * uu + p.y * vv + 1.2 * ww);
    
    var t = 0.0;
    var col = vec3f(0.01, 0.01, 0.02);
    
    for(var i=0; i<160; i++) {
        let d = map(ro + rd * t);
        if(d < 0.002) {
            let pos = ro + rd * t;
            let nor = calcNormal(pos);
            let view = -rd;
            let shadow = calcSoftShadow(pos, normalize(vec3f(0.5, 1.0, 0.5)), 0.05, 10.0, 16.0);
            let ao = calcAO(pos, nor);
            
            var albedo = vec3f(0.05); // Black Glass
            var emissive = vec3f(0.0);

            // Screen Mapping
            if (pos.y > -1.9 && abs(nor.x) > 0.8) {
                 // Map texture to screen face
                 let z = pos.z + u.time * u.flowSpeed;
                 let rep = 4.0;
                 let zLocal = (fract(z/rep) - 0.5) * rep;
                 let uvScreen = vec2f(zLocal / 2.4 + 0.5, (pos.y + 1.5) / 3.0);
                 
                 let tex = textureSampleLevel(channel0, sampler0, (uvScreen * u.textureScale) + u.textureOffset, 0.0).rgb;
                 emissive = tex * u.baseColor * 5.0;
                 albedo = vec3f(0.0);
            }

            col = renderPBR(pos, nor, view, albedo, u.roughness, u.metallic, shadow, ao);
            col += emissive;
            
            // Reflections
            let reflDir = reflect(-view, nor);
            let groundRefl = max(0.0, -reflDir.y) * 0.5; // Fake ground bounce
            col += groundRefl * vec3f(0.1, 0.2, 0.5) * u.metallic;
            
            break;
        }
        t += d * 0.8;
        if(t > 60.0) { break; }
    }
    
    col = mix(col, vec3f(0.01, 0.02, 0.05), 1.0 - exp(-0.03 * t));
    col += postFX;
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(col, vec3f(1.0/2.2));
    col += (gold_noise(uv * u.resolution, u.time) - 0.5) * u.grainStrength;
    return vec4f(col, 1.0);
}
`;

const PRESET_CORE = `
${COMMON_HEADER}
  spinSpeed: f32,
  ior: f32,
  roughness: f32,
  grainStrength: f32,
  baseColor: vec3f,
  _pad_color: f32,
${COMMON_FOOTER}
${COMMON_FUNCTIONS}

fn map(p: vec3f) -> f32 {
    let dSphere = sdSphere(p, 1.0);
    let r = rotate(u.time * u.spinSpeed);
    var p2 = p;
    p2.xz = r * p2.xz;
    let ring = sdTorus(p2, vec2f(1.5, 0.05));
    return min(dSphere, ring);
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = 0.001;
    return normalize(vec3f(
        map(p + vec3f(e, 0, 0)) - map(p - vec3f(e, 0, 0)),
        map(p + vec3f(0, e, 0)) - map(p - vec3f(0, e, 0)),
        map(p + vec3f(0, 0, e)) - map(p - vec3f(0, 0, e))
    ));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    ${SCROLL_UV_LOGIC}

    let ro = vec3f(0.0, 0.0, 4.0);
    let rd = normalize(vec3f(p, -1.0));
    var col = vec3f(0.01);
    var t = 0.0;
    
    for(var i=0; i<80; i++) {
        let d = map(ro + rd * t);
        if(d < 0.002) {
            let pos = ro + rd * t;
            let nor = calcNormal(pos);
            let view = -rd;
            
            if (length(pos) < 1.1) {
                // Core
                col = u.baseColor * 5.0 * fbm(pos * 5.0 + u.time);
            } else {
                // Ring
                col = renderPBR(pos, nor, view, vec3f(0.8), u.roughness, 1.0, 1.0, 1.0);
            }
            break;
        }
        t += d * 0.8;
    }
    
    col += postFX;
    col = pow(col, vec3f(0.4545));
    col += (gold_noise(uv * u.resolution, u.time) - 0.5) * u.grainStrength;
    return vec4f(col, 1.0);
}
`;

const PRESET_CARD = `
${COMMON_HEADER}
  spinSpeed: f32,
  metallic: f32,
  roughness: f32,
  grainStrength: f32,
  baseColor: vec3f,
  _pad_color: f32,
${COMMON_FOOTER}
${COMMON_FUNCTIONS}

fn map(p: vec3f) -> f32 {
    // Parallax Interaction: Tilt based on mouse
    let tiltX = (u.mouse.x - 0.5) * 0.5;
    let tiltY = (u.mouse.y - 0.5) * 0.5;
    
    let rX = rotate(tiltY + 0.1 * sin(u.time * 0.5));
    let rY = rotate(-tiltX + u.time * u.spinSpeed * 0.1); 

    var p2 = p;
    p2.yz = rX * p2.yz;
    p2.xz = rY * p2.xz;
    
    // Glass Slab Device - slightly thinner, smoother
    return sdRoundBox(p2, vec3f(1.6, 1.0, 0.01), 0.04); 
}

fn calcNormal(p: vec3f) -> vec3f {
    let e = 0.001;
    return normalize(vec3f(
        map(p + vec3f(e, 0, 0)) - map(p - vec3f(e, 0, 0)),
        map(p + vec3f(0, e, 0)) - map(p - vec3f(0, e, 0)),
        map(p + vec3f(0, 0, e)) - map(p - vec3f(0, 0, e))
    ));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    ${SCROLL_UV_LOGIC}

    // Fixed Camera
    let ro = vec3f(0.0, 0.0, 3.8);
    let rd = normalize(vec3f(p, -1.0));
    
    var t = 0.0;
    var col = vec3f(0.02); // Dark Studio
    
    for(var i=0; i<64; i++) {
        let d = map(ro + rd * t);
        if(d < 0.002) {
            let pos = ro + rd * t;
            let nor = calcNormal(pos);
            let view = -rd;
            
            // Re-Apply rotation to get local UVs
            let tiltX = (u.mouse.x - 0.5) * 0.5;
            let tiltY = (u.mouse.y - 0.5) * 0.5;
            let rX = rotate(-(tiltY + 0.1 * sin(u.time * 0.5)));
            let rY = rotate(-(-tiltX + u.time * u.spinSpeed * 0.1));
            
            var localP = pos;
            localP.xz = rY * localP.xz;
            localP.yz = rX * localP.yz;
            
            let uvScreen = vec2f((localP.x / 1.6) * 0.5 + 0.5, (localP.y / 1.0) * 0.5 + 0.5);
            
            var albedo = vec3f(0.01);
            var emissive = vec3f(0.0);
            
            // Screen Area (Front Face Only)
            if (localP.z > 0.0 && abs(localP.x) < 1.55 && abs(localP.y) < 0.95) {
                // Correct UV orientation (flip Y)
                let texUV = vec2f(uvScreen.x, 1.0 - uvScreen.y);
                let finalUV = (texUV * u.textureScale) + u.textureOffset;
                let tex = textureSampleLevel(channel0, sampler0, clamp(finalUV, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
                
                // Emissive Display
                emissive = tex * 1.5; 
                
                // Add Glass Reflection on top
                let fresnel = pow(1.0 - max(dot(view, nor), 0.0), 3.0);
                emissive += vec3f(1.0) * fresnel * 0.2;
            } else {
                // Metal Frame
                albedo = u.baseColor;
            }
            
            let shadow = calcSoftShadow(pos, normalize(vec3f(0.5, 0.5, 1.0)), 0.02, 5.0, 16.0);
            let ao = calcAO(pos, nor);
            col = renderPBR(pos, nor, view, albedo, u.roughness, u.metallic, shadow, ao);
            col += emissive;
            
            break;
        }
        t += d;
    }
    
    col += postFX;
    if (abs(u.scrollType - 6.0) < 0.1 && length(postFX) == 0.0) {
        let center = vec2f(0.5);
        if (length(uv - center) < 0.15 * (u.scrollY * u.scrollParam1 * 0.3 * 5.0)) { col = vec3f(0.0); }
    }

    // Tone Mapping
    col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
    col = pow(col, vec3f(1.0/2.2));
    col += (gold_noise(uv * u.resolution, u.time) - 0.5) * u.grainStrength;
    
    return vec4f(col, 1.0);
}
`;

export const PRESETS: Preset[] = [
    {
        id: 'chrome',
        name: 'Hyper Chrome',
        description: 'Polished liquid metal with studio lighting. Uses GGX PBR.',
        shaderCode: PRESET_CHROME,
        tags: ['PBR', 'Studio', 'Metal'],
        params: [
            { id: 'flowSpeed', label: 'Flow', type: 'float', value: 0.5, min: 0.0, max: 2.0 },
            { id: 'metallic', label: 'Metalness', type: 'float', value: 1.0, min: 0.0, max: 1.0 },
            { id: 'roughness', label: 'Roughness', type: 'float', value: 0.05, min: 0.01, max: 1.0 },
            { id: 'grainStrength', label: 'Film Grain', type: 'float', value: 0.05, min: 0.0, max: 0.2 },
            { id: 'baseColor', label: 'Albedo', type: 'color', value: [1.0, 1.0, 1.0] },
        ]
    },
    {
        id: 'gold',
        name: 'Liquid Gold',
        description: 'Viscous, high-value metallic fluid simulation.',
        shaderCode: PRESET_GOLD,
        tags: ['Luxury', 'Fluid', 'Gold'],
        params: [
            { id: 'waveSpeed', label: 'Viscosity', type: 'float', value: 0.3, min: 0.0, max: 2.0 },
            { id: 'metallic', label: 'Metalness', type: 'float', value: 1.0, min: 0.0, max: 1.0 },
            { id: 'roughness', label: 'Roughness', type: 'float', value: 0.12, min: 0.01, max: 1.0 },
            { id: 'grainStrength', label: 'Noise', type: 'float', value: 0.02, min: 0.0, max: 0.1 },
            { id: 'baseColor', label: 'Gold Tint', type: 'color', value: [1.0, 0.7, 0.1] },
        ]
    },
    {
        id: 'obsidian',
        name: 'Obsidian Data',
        description: 'Hall of mirrors with floating data terminals.',
        shaderCode: PRESET_OBSIDIAN,
        tags: ['Dark', 'Cyber', 'Tech'],
        params: [
            { id: 'flowSpeed', label: 'Speed', type: 'float', value: 1.0, min: 0.0, max: 5.0 },
            { id: 'metallic', label: 'Reflectivity', type: 'float', value: 0.9, min: 0.0, max: 1.0 },
            { id: 'roughness', label: 'Roughness', type: 'float', value: 0.1, min: 0.01, max: 1.0 },
            { id: 'grainStrength', label: 'Dither', type: 'float', value: 0.03, min: 0.0, max: 0.2 },
            { id: 'baseColor', label: 'Glow Tint', type: 'color', value: [0.0, 0.8, 1.0] },
        ]
    },
    {
        id: 'core',
        name: 'Optical Core',
        description: 'Dyson sphere containment ring.',
        shaderCode: PRESET_CORE,
        tags: ['Sci-Fi', 'Energy', 'Glass'],
        params: [
            { id: 'spinSpeed', label: 'Spin', type: 'float', value: 0.5, min: 0.0, max: 5.0 },
            { id: 'ior', label: 'Refraction', type: 'float', value: 1.45, min: 1.0, max: 2.0 },
            { id: 'roughness', label: 'Containment', type: 'float', value: 0.2, min: 0.0, max: 1.0 },
            { id: 'grainStrength', label: 'Radiation', type: 'float', value: 0.04, min: 0.0, max: 0.2 },
            { id: 'baseColor', label: 'Plasma', type: 'color', value: [1.0, 0.4, 0.0] },
        ]
    },
    {
        id: 'card',
        name: 'Nano Card',
        description: 'Holographic glass tablet with interactive tilt.',
        shaderCode: PRESET_CARD,
        tags: ['Product', 'UI', 'Glass'],
        params: [
            { id: 'spinSpeed', label: 'Drift', type: 'float', value: 0.2, min: 0.0, max: 2.0 },
            { id: 'metallic', label: 'Frame', type: 'float', value: 0.9, min: 0.0, max: 1.0 },
            { id: 'roughness', label: 'Glass', type: 'float', value: 0.05, min: 0.0, max: 1.0 },
            { id: 'grainStrength', label: 'Grain', type: 'float', value: 0.02, min: 0.0, max: 0.1 },
            { id: 'baseColor', label: 'Bezel', type: 'color', value: [0.1, 0.1, 0.1] },
        ]
    }
];