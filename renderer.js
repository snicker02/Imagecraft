// renderer.js — WebGL1 viewer for the block mesh. No dependencies, no extensions.

const VS = `
precision highp float;
attribute vec3 aPos;
attribute float aShade;
attribute vec3 aColor;
uniform mat4 uProj, uView;
varying float vShade;
varying vec3 vColor;
varying float vDepth;
void main() {
  vec4 eye = uView * vec4(aPos, 1.0);
  gl_Position = uProj * eye;
  vShade = aShade;
  vColor = aColor;
  vDepth = -eye.z;
}`;

const FS = `
precision highp float;
varying float vShade;
varying vec3 vColor;
varying float vDepth;
uniform vec3 uFog;
uniform float uFogNear, uFogFar, uAmbient;
void main() {
  vec3 c = vColor * mix(uAmbient, 1.0, vShade);
  float f = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  c = mix(c, uFog, f * 0.85);
  gl_FragColor = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
  return s;
}

// --- tiny mat4 --------------------------------------------------------------
function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  return out;
}
function lookAt(out, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out.set([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
  return out;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: true, alpha: false, preserveDrawingBuffer: true, depth: true,
    });
    if (!gl) throw new Error('WebGL1 is not available in this browser.');
    this.gl = gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aShade');
    gl.bindAttribLocation(prog, 2, 'aColor');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
    this.prog = prog;
    this.u = {
      proj: gl.getUniformLocation(prog, 'uProj'),
      view: gl.getUniformLocation(prog, 'uView'),
      fog: gl.getUniformLocation(prog, 'uFog'),
      near: gl.getUniformLocation(prog, 'uFogNear'),
      far: gl.getUniformLocation(prog, 'uFogFar'),
      amb: gl.getUniformLocation(prog, 'uAmbient'),
    };
    this.buf = gl.createBuffer();
    this.verts = 0;
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);

    this.center = [0, 0, 0];
    this.dist = 40;
    this.yaw = 0.0;
    this.pitch = 0.22;
    this.ambient = 0.45;
    this.bg = [0.055, 0.063, 0.078];
    this.dirty = true;

    this._bindInput();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setMesh(mesh, vox) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    this.verts = mesh.verts;
    this.stride = mesh.stride * 4;
    if (vox) {
      this.center = [vox.sx / 2, vox.sy / 2, vox.sz / 2];
      this.fit = Math.max(vox.sx, vox.sy, vox.sz);
    }
    this.dirty = true;
  }

  frame() {
    const f = this.fit || 32;
    this.dist = f * 1.6;
    this.yaw = 0; this.pitch = 0.18;
    this.dirty = true;
  }

  _bindInput() {
    const c = this.canvas;
    let drag = null;
    const pos = e => ({ x: e.clientX, y: e.clientY });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      drag = { ...pos(e), button: e.button, yaw: this.yaw, pitch: this.pitch, cx: this.center.slice() };
    });
    c.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.button === 0 && !e.shiftKey) {
        this.yaw = drag.yaw + dx * 0.008;
        this.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + dy * 0.008));
      } else {
        const s = this.dist * 0.0018;
        const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        this.center = [
          drag.cx[0] - right[0] * dx * s,
          drag.cx[1] + dy * s,
          drag.cx[2] - right[2] * dx * s,
        ];
      }
      this.dirty = true;
    });
    const end = e => { if (drag) { c.releasePointerCapture(e.pointerId); drag = null; } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = Math.max(2, Math.min(6000, this.dist * Math.exp(e.deltaY * 0.0012)));
      this.dirty = true;
    }, { passive: false });
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.dirty = true; }
  }

  _loop() {
    this.resize();
    if (this.dirty) { this.draw(); this.dirty = false; }
    requestAnimationFrame(this._loop);
  }

  draw() {
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.verts) return;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye = [
      this.center[0] + this.dist * cp * Math.sin(this.yaw),
      this.center[1] + this.dist * sp,
      this.center[2] + this.dist * cp * Math.cos(this.yaw),
    ];
    perspective(this.proj, 50 * Math.PI / 180, c.width / c.height, 0.1, this.dist * 8 + 500);
    lookAt(this.view, eye, this.center, [0, 1, 0]);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.proj, false, this.proj);
    gl.uniformMatrix4fv(this.u.view, false, this.view);
    gl.uniform3fv(this.u.fog, this.bg);
    gl.uniform1f(this.u.near, this.dist * 0.9);
    gl.uniform1f(this.u.far, this.dist * 3.2);
    gl.uniform1f(this.u.amb, this.ambient);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, this.stride, 0);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, this.stride, 12);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, this.stride, 16);
    gl.drawArrays(gl.TRIANGLES, 0, this.verts);
  }
}
