

export const BOILERPLATE_SHADER_WGSL = `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  dt: f32,
  cameraPos: vec4f,
  mouse: vec4f, // xy = coords, z = click, w = scroll
  
  // Params
  animSpeed: f32,
  boxRoughness: f32,
  vignette: f32,
  grainStrength: f32, // Replaces padding at offset 60
  
  baseColor: vec3f,
  _pad_color: f32,
  
  lightAz: f32,
  lightEl: f32,
  isRendering: f32, // 0=Preview, 1=HQ, 2=Ultra
  aberrationStrength: f32,
  
  audio: vec4f, // Low, Mid, High, Vol
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

// --- SDF FUNCTIONS ---
fn sdBox(p: vec3f, b: vec3f) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdSphere(p: vec3f, s: f32) -> f32 {
  return length(p) - s;
}

fn map(p: vec3f) -> vec2f {
  // Audio Distortion
  let pulse = u.audio.x * 0.5; // Bass
  
  var p2 = p;
  // Twist based on height and audio
  let k = 0.5 + pulse;
  let c = cos(k*p2.y);
  let s = sin(k*p2.y);
  let m = mat2x2f(c, -s, s, c);
  p2 = vec3f(m * p2.xz, p2.y).xzy;

  // Central Object
  let box = sdBox(p2 - vec3f(0.0, 0.5, 0.0), vec3f(1.0)) - 0.1;
  
  // Floor
  let floorDist = p.y + 1.0 + sin(p.x * 0.5 + u.time) * 0.1 * u.audio.z; // High freqs ripple floor
  
  if (box < floorDist) {
      return vec2f(box, 1.0); // ID 1 = Box
  }
  return vec2f(floorDist, 2.0); // ID 2 = Floor
}

fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.001;
  return normalize(vec3f(
    map(p + vec3f(e, 0.0, 0.0)).x - map(p - vec3f(e, 0.0, 0.0)).x,
    map(p + vec3f(0.0, e, 0.0)).x - map(p - vec3f(0.0, e, 0.0)).x,
    map(p + vec3f(0.0, 0.0, e)).x - map(p - vec3f(0.0, 0.0, e)).x
  ));
}

fn getSoftShadow(ro: vec3f, rd: vec3f, tmin: f32, tmax: f32, k: f32) -> f32 {
  var res = 1.0;
  var t = tmin;
  for (var i = 0; i < 16; i++) {
    let h = map(ro + rd * t).x;
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.2);
    if (res < 0.005 || t > tmax) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

fn getAO(p: vec3f, n: vec3f) -> f32 {
    var occ = 0.0;
    var sca = 1.0;
    for(var i=0; i<5; i++) {
        let h = 0.01 + 0.12*f32(i)/4.0;
        let d = map(p + h*n).x;
        occ += (h-d)*sca;
        sca *= 0.95;
        if(occ > 0.35) { break; }
    }
    return clamp(1.0 - 3.0*occ, 0.0, 1.0) * (0.5 + 0.5*n.y);
}

// Gold Noise for Film Grain
fn gold_noise(xy: vec2f, seed: f32) -> f32 {
    return fract(tan(distance(xy*1.61803398874989484820459, xy)*seed)*xy.x);
}

// Raymarch Function
fn raymarch(ro: vec3f, rd: vec3f, maxSteps: i32) -> vec2f {
    var t = 0.0;
    var m = -1.0;
    for (var i = 0; i < maxSteps; i++) {
        let pos = ro + rd * t;
        let res = map(pos);
        if (res.x < 0.001 || t > 50.0) {
            if (res.x < 0.001) { m = res.y; }
            break;
        }
        t += res.x;
    }
    if (t > 50.0) { m = -1.0; }
    return vec2f(t, m);
}

// Shade Function
fn shade(p: vec3f, n: vec3f, rd: vec3f, matID: f32) -> vec3f {
    let lightPos = vec3f(10.0 * cos(u.lightAz * 6.28), 10.0 * u.lightEl + 2.0, 10.0 * sin(u.lightAz * 6.28));
    let l = normalize(lightPos - p);
    let h = normalize(l - rd); // Half vector for specular
    
    // Shadows & AO
    var shadow = 1.0;
    var ao = 1.0;
    if (u.isRendering > 0.5) {
        shadow = getSoftShadow(p, l, 0.02, 10.0, 8.0);
        ao = getAO(p, n);
    }
    
    // Material
    var albedo = u.baseColor;
    var roughness = u.boxRoughness;
    
    // Texture Mapping for Box
    if (matID == 1.0) {
        // Triplanar-ish mapping or just box mapping
        let uv = p.xz * 0.5 + 0.5;
        let tex = textureSampleLevel(channel0, sampler0, uv, 0.0).rgb;
        albedo = mix(albedo, tex, 0.5); // Blend texture with base color
    }
    // Checkerboard Floor
    if (matID == 2.0) {
        // Safe Modulo: fract(x * 0.5) * 2.0 returns 0 or 1 based on parity
        let f = fract((floor(p.x) + floor(p.z)) * 0.5) * 2.0;
        albedo = vec3f(0.1 + f * 0.1);
        roughness = 0.2;
        // Fade checkerboard in distance
        let dist = length(p.xz);
        albedo = mix(albedo, vec3f(0.05), smoothstep(10.0, 30.0, dist));
    }

    // Lighting (PBR-ish)
    let diff = max(dot(n, l), 0.0);
    let spec = pow(max(dot(n, h), 0.0), (1.0 - roughness) * 64.0);
    let fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
    
    // Rim Light (Cinematic)
    let rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.5;

    var color = albedo * diff * shadow * ao + vec3f(spec) * shadow + vec3f(rim) * 0.2;
    
    // Ambient
    color += albedo * 0.05 * ao;

    return color;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Setup Camera
  let ro = u.cameraPos.xyz;
  let ta = vec3f(0.0, 0.5, 0.0);
  let ww = normalize(ta - ro);
  let uu = normalize(cross(ww, vec3f(0.0, 1.0, 0.0)));
  let vv = normalize(cross(uu, ww));

  var tot = vec3f(0.0);
  
  // Antialiasing / Chromatic Aberration Loop
  // In preview (isRendering=0), we do 1 sample. In HQ, we jitter.
  var samples = 1;
  if (u.isRendering > 0.5) { samples = 4; } // 4x AA in HQ
  
  for (var i = 0; i < samples; i++) {
      // Jitter UV for AA
      var offset = vec2f(0.0);
      if (samples > 1) {
          offset = (vec2f(gold_noise(uv, f32(i)), gold_noise(uv + 10.0, f32(i))) - 0.5) / u.resolution;
      }
      
      let p = (-u.resolution + 2.0 * (uv + offset) * u.resolution) / u.resolution.y;
      
      // Chromatic Aberration Offset per channel
      var colorSum = vec3f(0.0);
      let channels = vec3f(0.0, 1.0, 2.0); // R, G, B offsets
      
      for (var c = 0; c < 3; c++) {
          let abOffset = (f32(c) - 1.0) * u.aberrationStrength * 0.01;
          let rd = normalize(p.x * uu + p.y * vv + 1.5 * ww + abOffset * uu);
          
          var steps = 128;
          if (u.isRendering > 1.5) { steps = 256; } // Ultra Steps
          
          let res = raymarch(ro, rd, steps);
          let t = res.x;
          let m = res.y;
          
          var col = vec3f(0.05); // Background
          
          if (m > 0.0) {
              let pos = ro + rd * t;
              let nor = calcNormal(pos);
              col = shade(pos, nor, rd, m);
              
              // Reflections (Global Illumination - Ultra Only)
              if (u.isRendering > 1.5 && m == 2.0) { // Floor reflects
                  let reflDir = reflect(rd, nor);
                  let resRef = raymarch(pos + nor * 0.01, reflDir, 64);
                  if (resRef.y > 0.0) {
                      let posRef = pos + reflDir * resRef.x;
                      let norRef = calcNormal(posRef);
                      let colRef = shade(posRef, norRef, reflDir, resRef.y);
                      // Fresnel reflection strength
                      let f = 0.1 + 0.4 * pow(1.0 - max(dot(-rd, nor), 0.0), 5.0);
                      col = mix(col, colRef, f * u.boxRoughness); // Roughness blurs reflection (fake)
                  }
              }
              
              // Fog
              col = mix(col, vec3f(0.05), 1.0 - exp(-0.02 * t * t));
          }
          
          if (c == 0) { colorSum.r = col.r; }
          if (c == 1) { colorSum.g = col.g; }
          if (c == 2) { colorSum.b = col.b; }
      }
      tot += colorSum;
  }
  
  tot /= f32(samples);

  // Vignette
  let q = uv;
  tot *= 0.5 + 0.5 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), u.vignette);

  // Film Grain
  let grain = gold_noise(uv * u.resolution, u.time) * u.grainStrength;
  tot += grain;

  // Tone Mapping (ACES-ish)
  tot = (tot * (2.51 * tot + 0.03)) / (tot * (2.43 * tot + 0.59) + 0.14);
  tot = pow(tot, vec3f(1.0 / 2.2)); // Gamma

  return vec4f(tot, 1.0);
}
`