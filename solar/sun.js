// Sol hero, extracted from the saved page's createSolSun shader. The original
// scene draws a single plane only on resize, so it needs no 3D scene graph.
const vertexSource = `#version 300 es
out vec2 point;
void main() {
  vec2 position = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  point = position * 2.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 point;
out vec4 fragColor;
void main() {
  float radius = length(point);
  float edge = max(fwidth(radius), 0.001);
  float disc = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, radius);
  float facing = sqrt(max(0.0, 1.0 - radius * radius));
  vec3 surface = mix(vec3(0.94, 0.91, 0.68), vec3(0.96, 0.95, 0.86), smoothstep(0.0, 0.8, facing));
  float outside = max(radius - 1.0, 0.0);
  float halo = (exp(-outside * 4.8) * 0.8 + exp(-outside * 1.15) * 0.08)
    * (1.0 - smoothstep(2.0, 2.5, radius)) * 0.75;
  float alpha = disc + halo * (1.0 - disc);
  vec3 color = (surface * disc + vec3(1.0, 0.65, 0.16) * halo * (1.0 - disc)) / max(alpha, 0.0001);
  fragColor = vec4(color, alpha);
}`;

function sunLayer(canvas, redraw, release = () => {}) {
  const element = document.createElement('div');
  element.className = 'solar-sun';
  element.append(canvas);
  let lastMask, lastSize;
  return {
    element,
    render(time, x, y, halfSize, opacity, mask) {
      const size = halfSize * 5;
      element.style.opacity = String(opacity);
      if (lastMask !== mask) {
        element.style.maskImage = mask;
        lastMask = mask;
      }
      canvas.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
      if (size !== lastSize) {
        canvas.style.width = canvas.style.height = size + 'px';
        lastSize = size;
      }
      redraw(size);
    },
    dispose() {
      element.remove();
      release();
    },
  };
}

export function createSolSun(maxPixels, dpr) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false });
  if (!gl) throw new Error('WebGL 2 unavailable');
  const program = gl.createProgram();
  function release() {
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    let previousPixels = 0;
    return sunLayer(canvas, size => {
      if (gl.isContextLost()) throw new Error('Sun context lost');
      const pixels = Math.max(1, Math.min(maxPixels, Math.ceil(size * Math.min(devicePixelRatio || 1, dpr))));
      if (pixels === previousPixels) return;
      canvas.width = canvas.height = pixels;
      gl.viewport(0, 0, pixels, pixels);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      previousPixels = pixels;
    }, release);
  } catch (error) {
    release();
    throw error;
  }
}

export function createFallbackSun() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const halo = ctx.createRadialGradient(256, 256, 96, 256, 256, 256);
  halo.addColorStop(0, '#fffddc');
  halo.addColorStop(0.04, '#ffdf72');
  halo.addColorStop(0.12, 'rgba(255,174,42,0.525)');
  halo.addColorStop(0.32, 'rgba(255,144,21,0.1125)');
  halo.addColorStop(1, 'rgba(255,117,20,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 512, 512);
  const disc = ctx.createRadialGradient(256, 256, 0, 256, 256, 102.4);
  disc.addColorStop(0, '#f5f2db');
  disc.addColorStop(1, '#f0e8ad');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(256, 256, 102.4, 0, 2 * Math.PI);
  ctx.fill();
  return sunLayer(canvas, () => {});
}
