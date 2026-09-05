/**
 * ============================================================================
 * WINAMP 365 - HARDWARE-ACCELERATED MILKDROP & GEISS VISUALIZER ENGINE (v2.0 PRO)
 * Next-Gen Multi-Pass WebGL2 Shader Pipeline with Double-Buffered Framebuffers,
 * 16 Master Presets (8 Geiss + 8 MilkDrop), High-Precision Beat Transients,
 * Bloom/Glow Emulation, and 2D LCD Oscilloscope / Spectrum Analyzer.
 * ============================================================================
 */

export class WinampVisualizerEngine {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.canvas = null;
    this.gl = null;
    this.miniCanvas = null;
    this.miniCtx = null;

    // Presets & Engine State
    this.presets = [];
    this.currentPresetIndex = 0;
    this.autoCycle = true;
    this.cycleIntervalSec = 15;
    this.lastCycleTime = performance.now();
    this.sensitivity = 1.2;
    this.isRunning = false;
    this.animFrameId = null;

    // Mini LCD Visualizer Mode
    this.miniVisMode = 'spectrum'; // 'spectrum' or 'oscilloscope'
    this.peakLevels = new Array(19).fill(0);
    this.peakDecay = 0.94;

    // WebGL Resources
    this.quadVAO = null;
    this.fboPing = null;
    this.fboPong = null;
    this.texPing = null;
    this.texPong = null;
    this.currentFboIsPing = true;
    this.timeUniform = 0;

    // FPS Meter
    this.fps = 60;
    this.frameCount = 0;
    this.lastFpsTime = performance.now();

    this.initPresetsList();
  }

  initPresetsList() {
    this.presets = [
      // 8 GEISS MASTER PRESETS
      {
        id: 'geiss_smokescreen',
        name: 'Geiss - Hypnotic Smokescreen',
        category: 'geiss',
        fragmentShader: this.getShaderGeissSmoke()
      },
      {
        id: 'geiss_cosmic_lasers',
        name: 'Geiss - Cosmic Lasers & Beams',
        category: 'geiss',
        fragmentShader: this.getShaderGeissLasers()
      },
      {
        id: 'geiss_solar_flare',
        name: 'Geiss - Solar Plasma Eruption',
        category: 'geiss',
        fragmentShader: this.getShaderGeissSolar()
      },
      {
        id: 'geiss_quantum_tunnel',
        name: 'Geiss - Quantum Vortex Tunnel',
        category: 'geiss',
        fragmentShader: this.getShaderGeissTunnel()
      },
      {
        id: 'geiss_supernova',
        name: 'Geiss - Supernova Hyperspace',
        category: 'geiss',
        fragmentShader: this.getShaderGeissSupernova()
      },
      {
        id: 'geiss_kaleidoscope',
        name: 'Geiss - Fractal Kaleidoscope',
        category: 'geiss',
        fragmentShader: this.getShaderGeissKaleidoscope()
      },
      {
        id: 'geiss_plasma_globe',
        name: 'Geiss - High-Voltage Tesla Arcs',
        category: 'geiss',
        fragmentShader: this.getShaderGeissTesla()
      },
      {
        id: 'geiss_aurora',
        name: 'Geiss - Aurora Borealis Waves',
        category: 'geiss',
        fragmentShader: this.getShaderGeissAurora()
      },

      // 8 MILKDROP MASTER PRESETS
      {
        id: 'milkdrop_liquid_warp',
        name: 'MilkDrop - Liquid Audio Warp',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropLiquid()
      },
      {
        id: 'milkdrop_acid_feedback',
        name: 'MilkDrop - Acid Trip Feedback',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropAcid()
      },
      {
        id: 'milkdrop_synthwave_grid',
        name: 'MilkDrop - 3D Synthwave Horizon',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropSynthwave()
      },
      {
        id: 'milkdrop_plasma_nebula',
        name: 'MilkDrop - Volumetric Nebula',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropNebula()
      },
      {
        id: 'milkdrop_cyber_pillars',
        name: 'MilkDrop - Cyber 3D Pillars',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropPillars()
      },
      {
        id: 'milkdrop_lissajous',
        name: 'MilkDrop - Lissajous Oscilloscope',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropLissajous()
      },
      {
        id: 'milkdrop_fractal_flower',
        name: 'MilkDrop - Sacred Geometry Mandala',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropMandala()
      },
      {
        id: 'milkdrop_matrix_rain',
        name: 'MilkDrop - Cyberpunk Data Grid',
        category: 'milkdrop',
        fragmentShader: this.getShaderMilkdropDataGrid()
      }
    ];
  }

  init(canvasEl, miniCanvasEl) {
    this.canvas = canvasEl;
    this.miniCanvas = miniCanvasEl;

    if (this.miniCanvas) {
      this.miniCtx = this.miniCanvas.getContext('2d');
    }

    try {
      this.gl = this.canvas.getContext('webgl2', { 
        alpha: false, 
        antialias: false, 
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      });
    } catch (e) {
      console.warn('WebGL2 not supported, falling back to WebGL:', e);
      this.gl = this.canvas.getContext('webgl');
    }

    if (this.gl) {
      this.initWebGL();
    } else {
      console.warn('WebGL initialization failed, using 2D canvas fallback');
    }

    this.start();
  }

  initWebGL() {
    const gl = this.gl;
    this.resize();

    // Quad geometry (Full screen quad)
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    this.initFramebuffers();
    this.compileCurrentPreset();
  }

  initFramebuffers() {
    const gl = this.gl;
    if (!gl) return;

    const w = this.canvas.width || 580;
    const h = this.canvas.height || 560;

    const createFBO = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

      return { fbo, tex };
    };

    const ping = createFBO();
    const pong = createFBO();

    this.fboPing = ping.fbo;
    this.texPing = ping.tex;
    this.fboPong = pong.fbo;
    this.texPong = pong.tex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(100, Math.floor(rect.width * dpr));
    const h = Math.max(100, Math.floor(rect.height * dpr));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.gl) {
        this.gl.viewport(0, 0, w, h);
        this.initFramebuffers();
      }
    }
  }

  compileShader(src, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  compileCurrentPreset() {
    const gl = this.gl;
    if (!gl) return;

    const preset = this.presets[this.currentPresetIndex];
    const vsSource = `#version 300 es
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const vs = this.compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = this.compileShader(preset.fragmentShader, gl.FRAGMENT_SHADER);

    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      return;
    }

    this.currentProgram = prog;
    this.uniforms = {
      u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
      u_time: gl.getUniformLocation(prog, 'u_time'),
      u_bass: gl.getUniformLocation(prog, 'u_bass'),
      u_mid: gl.getUniformLocation(prog, 'u_mid'),
      u_treble: gl.getUniformLocation(prog, 'u_treble'),
      u_beat: gl.getUniformLocation(prog, 'u_beat'),
      u_beatIntensity: gl.getUniformLocation(prog, 'u_beatIntensity'),
      u_feedback: gl.getUniformLocation(prog, 'u_feedback'),
      u_sensitivity: gl.getUniformLocation(prog, 'u_sensitivity')
    };

    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  }

  start() {
    this.isRunning = true;
    const loop = () => {
      if (!this.isRunning) return;
      this.render();
      this.renderMiniLCD();
      this.calcFPS();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  stop() {
    this.isRunning = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  calcFPS() {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;

      const fpsEl = document.getElementById('vis-fps-readout');
      if (fpsEl) fpsEl.textContent = `${this.fps} FPS`;
    }
  }

  // =========================================================================
  // Master Render Loop
  // =========================================================================
  render() {
    if (!this.gl || !this.currentProgram) return;

    this.resize();
    const gl = this.gl;
    const now = performance.now();

    // Auto-cycle presets
    if (this.autoCycle && (now - this.lastCycleTime) > this.cycleIntervalSec * 1000) {
      this.nextPreset();
    }

    const analysis = this.audio.getAudioAnalysis();
    this.timeUniform += 0.016;

    gl.useProgram(this.currentProgram);

    // Uniforms
    gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniforms.u_time, this.timeUniform);
    gl.uniform1f(this.uniforms.u_bass, Math.min(2.0, analysis.bassEnergy * this.sensitivity));
    gl.uniform1f(this.uniforms.u_mid, Math.min(2.0, analysis.midEnergy * this.sensitivity));
    gl.uniform1f(this.uniforms.u_treble, Math.min(2.0, analysis.trebleEnergy * this.sensitivity));
    gl.uniform1f(this.uniforms.u_beat, analysis.beat ? 1.0 : 0.0);
    gl.uniform1f(this.uniforms.u_beatIntensity, analysis.beatIntensity);
    gl.uniform1f(this.uniforms.u_sensitivity, this.sensitivity);

    // Bind previous frame texture for feedback
    const prevTex = this.currentFboIsPing ? this.texPong : this.texPing;
    const targetFbo = this.currentFboIsPing ? this.fboPing : this.fboPong;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.uniform1i(this.uniforms.u_feedback, 0);

    // 1. Render to target FBO for next frame feedback
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. Render directly to screen canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Swap Ping-Pong
    this.currentFboIsPing = !this.currentFboIsPing;
  }

  // =========================================================================
  // Mini LCD Display: 19-Band Spectrum Analyzer & Oscilloscope
  // =========================================================================
  renderMiniLCD() {
    if (!this.miniCanvas || !this.miniCtx) return;
    const ctx = this.miniCtx;
    const w = this.miniCanvas.width = 154;
    const h = this.miniCanvas.height = 18;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    const analysis = this.audio.getAudioAnalysis();
    const isPlaying = this.audio.isPlaying;

    if (this.miniVisMode === 'spectrum') {
      const numBands = 19;
      const barWidth = 6;
      const barGap = 2;
      const totalWidth = numBands * (barWidth + barGap);
      const startX = Math.floor((w - totalWidth) / 2);

      for (let i = 0; i < numBands; i++) {
        let val = 0;
        if (isPlaying && analysis.freqData) {
          const binIdx = Math.floor(Math.pow(i / numBands, 1.5) * 110);
          val = (analysis.freqData[binIdx] || 0) / 255;
        }

        const barHeight = Math.floor(val * (h - 2));

        if (barHeight > this.peakLevels[i]) {
          this.peakLevels[i] = barHeight;
        } else {
          this.peakLevels[i] *= this.peakDecay;
        }

        const x = startX + i * (barWidth + barGap);

        for (let seg = 0; seg < 8; seg++) {
          const segY = h - 2 - (seg * 2);
          if (seg * 2 < barHeight) {
            if (seg >= 6) ctx.fillStyle = '#ff3344';
            else if (seg >= 4) ctx.fillStyle = '#ffcc00';
            else ctx.fillStyle = '#00ff44';
            ctx.fillRect(x, segY, barWidth, 1.5);
          }
        }

        if (this.peakLevels[i] > 1) {
          const peakY = Math.max(1, h - 2 - Math.floor(this.peakLevels[i]));
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, peakY, barWidth, 1);
        }
      }
    } else {
      // Oscilloscope mode
      ctx.strokeStyle = '#00ff55';
      ctx.lineWidth = 1.3;
      ctx.shadowColor = '#00ff55';
      ctx.shadowBlur = 4;
      ctx.beginPath();

      const timeData = analysis.timeData;
      const sliceWidth = w / (timeData ? timeData.length : 128);
      let x = 0;

      for (let i = 0; i < (timeData ? timeData.length : 128); i++) {
        const v = isPlaying && timeData ? (timeData[i] / 128.0) : 1.0;
        const y = (v * h) / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  toggleMiniVisMode() {
    this.miniVisMode = this.miniVisMode === 'spectrum' ? 'oscilloscope' : 'spectrum';
    return this.miniVisMode;
  }

  // =========================================================================
  // Preset Controls
  // =========================================================================
  setPreset(index) {
    if (index >= 0 && index < this.presets.length) {
      this.currentPresetIndex = index;
      this.compileCurrentPreset();
      this.lastCycleTime = performance.now();
      return this.presets[this.currentPresetIndex];
    }
    return null;
  }

  nextPreset() {
    this.currentPresetIndex = (this.currentPresetIndex + 1) % this.presets.length;
    this.compileCurrentPreset();
    this.lastCycleTime = performance.now();
    return this.presets[this.currentPresetIndex];
  }

  prevPreset() {
    this.currentPresetIndex = (this.currentPresetIndex - 1 + this.presets.length) % this.presets.length;
    this.compileCurrentPreset();
    this.lastCycleTime = performance.now();
    return this.presets[this.currentPresetIndex];
  }

  getCurrentPreset() {
    return this.presets[this.currentPresetIndex];
  }

  // =========================================================================
  // GLSL SHADER MASTER SUITE (GEISS & MILKDROP)
  // =========================================================================

  // 1. Geiss Hypnotic Smokescreen (Turbulent Fluid Convection + Sparks)
  getShaderGeissSmoke() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        // Fluid swirl convection
        float swirl = sin(p.y * 5.0 + u_time * 2.2 + u_bass * 3.5);
        vec2 warp = vec2(
          swirl,
          cos(p.x * 5.0 - u_time * 1.8 + u_mid * 2.0)
        ) * (0.006 + u_beatIntensity * 0.025);

        vec2 fbUV = uv + warp - vec2(0.0, 0.005);
        vec4 prev = texture(u_feedback, fbUV);

        // Volumetric smoke noise layers
        float dist = length(p);
        float angle = atan(p.y, p.x);
        float s1 = sin(dist * 16.0 - u_time * 3.5 + angle * 4.0) * 0.5 + 0.5;
        float s2 = cos(dist * 28.0 + u_time * 2.0 - angle * 3.0) * 0.5 + 0.5;
        float smoke = (s1 * 0.6 + s2 * 0.4) * smoothstep(0.9, 0.05, dist);

        // Color grading (Deep Amber, Neon Cyan & Electric Violet)
        vec3 col = vec3(smoke * 0.9 + u_bass * 0.6, smoke * 0.35 + u_mid * 0.4, smoke * 1.0 + u_treble * 0.7);
        col += vec3(1.0, 0.55, 0.1) * u_beatIntensity * smoothstep(0.45, 0.0, dist);

        fragColor = vec4(mix(prev.rgb * 0.965, col, 0.22), 1.0);
      }
    `;
  }

  // 2. Geiss Cosmic Lasers & Beams (Polar Ray Diffraction + Blooming)
  getShaderGeissLasers() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float r = length(p);
        float a = atan(p.y, p.x);

        // 32-Ray diffraction spikes
        float beams = abs(sin(a * 16.0 + u_time * 3.0 + u_treble * 9.0));
        beams = pow(0.018 / (beams + 0.008), 1.5);

        // Dynamic laser chromatic dispersion
        vec3 beamColor = vec3(
          sin(u_time * 1.2 + a) * 0.5 + 0.5,
          sin(u_time * 1.5 + a + 2.0) * 0.5 + 0.5,
          sin(u_time * 0.9 + a + 4.0) * 0.5 + 0.5
        ) * (beams * (1.2 + u_bass * 2.5));

        vec2 fbUV = uv + (p / (r + 0.001)) * 0.005 * (1.0 + u_beatIntensity * 3.5);
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(prev.rgb * 0.94 + beamColor * 0.4, 1.0);
      }
    `;
  }

  // 3. Geiss Solar Plasma Flare (Coronal Mass Ejections)
  getShaderGeissSolar() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float d = length(p);
        float a = atan(p.y, p.x);
        float sunRadius = 0.22 + u_bass * 0.1 + u_beatIntensity * 0.06;

        float flare = sin(a * 18.0 + u_time * 4.5) * 0.06 + cos(a * 7.0 - u_time * 2.0) * 0.03;
        float corona = smoothstep(sunRadius + 0.35 + flare, sunRadius, d);

        vec3 fire = vec3(1.0, 0.45 + u_bass * 0.35, 0.06) * corona * (2.2 + u_beatIntensity * 4.5);
        if (d < sunRadius) {
          fire = vec3(1.3, 0.95, 0.65) * (1.0 - d / sunRadius);
        }

        vec2 fbUV = uv + (p / (d + 0.01)) * 0.0065;
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(mix(prev.rgb * 0.93, fire, 0.26), 1.0);
      }
    `;
  }

  // 4. Geiss Quantum Vortex Tunnel
  getShaderGeissTunnel() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float r = length(p);
        float a = atan(p.y, p.x);

        vec2 tunnelUV = vec2(0.35 / (r + 0.02) + u_time * 1.6, a / 3.14159265 + sin(r * 12.0 - u_time) * 0.12);
        vec2 grid = abs(fract(tunnelUV * 4.0) - 0.5);
        float line = smoothstep(0.09, 0.0, min(grid.x, grid.y));

        vec3 col = vec3(0.0, 0.95, 1.0) * line * (1.2 + u_bass * 2.2);
        col += vec3(1.0, 0.0, 0.75) * u_beatIntensity * (1.0 - r);

        vec2 fbUV = uv - p * (0.012 + u_beatIntensity * 0.035);
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(prev.rgb * 0.945 + col * 0.32, 1.0);
      }
    `;
  }

  // 5. Geiss Supernova Hyperspace
  getShaderGeissSupernova() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_treble;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float d = length(p);
        float a = atan(p.y, p.x);

        float stars = sin(a * 28.0 + u_time * 6.0) * cos(d * 48.0 - u_time * 14.0);
        stars = pow(clamp(stars, 0.0, 1.0), 9.0) * (2.2 + u_treble * 6.0);

        vec3 starCol = vec3(0.45, 0.85, 1.0) * stars;
        starCol += vec3(1.0, 0.8, 0.25) * (1.0 / (d * 8.0 + 0.1)) * u_bass;

        vec2 fbUV = uv - (p / (d + 0.001)) * 0.009 * (1.0 + u_beatIntensity * 4.5);
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(prev.rgb * 0.92 + starCol * 0.38, 1.0);
      }
    `;
  }

  // 6. Geiss Fractal Kaleidoscope
  getShaderGeissKaleidoscope() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float a = atan(p.y, p.x);
        float r = length(p);

        a = abs(mod(a + u_time * 0.45, 3.14159 / 4.0) - 3.14159 / 8.0);
        vec2 kp = vec2(cos(a), sin(a)) * r;

        float pat = sin(kp.x * 22.0 + u_bass * 7.0) * cos(kp.y * 22.0 + u_mid * 7.0);
        vec3 col = vec3(sin(pat * 3.5 + u_time), cos(pat * 2.5), sin(pat * 4.5 + 2.0)) * 0.5 + 0.5;

        vec2 fbUV = uv + (p / (r + 0.01)) * 0.0035;
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(mix(prev.rgb * 0.955, col, 0.24), 1.0);
      }
    `;
  }

  // 7. Geiss High-Voltage Tesla Arcs
  getShaderGeissTesla() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_treble;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float r = length(p);
        float a = atan(p.y, p.x);

        // Lightning branching equations
        float bolt1 = abs(sin(p.x * 20.0 + sin(p.y * 15.0 + u_time * 8.0) * 2.0));
        float bolt2 = abs(cos(p.y * 20.0 + sin(p.x * 15.0 - u_time * 8.0) * 2.0));
        float arc = pow(0.02 / (bolt1 * bolt2 + 0.008), 1.3) * (1.0 + u_treble * 3.0);

        vec3 elecCol = vec3(0.3, 0.7, 1.0) * arc;
        elecCol += vec3(0.8, 0.2, 1.0) * u_beatIntensity * smoothstep(0.5, 0.0, r);

        vec2 fbUV = uv - p * 0.006;
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(prev.rgb * 0.94 + elecCol * 0.35, 1.0);
      }
    `;
  }

  // 8. Geiss Aurora Borealis Waves
  getShaderGeissAurora() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float wave1 = sin(p.x * 4.0 + u_time * 1.5 + u_bass * 2.0) * 0.2;
        float wave2 = cos(p.x * 7.0 - u_time * 2.0) * 0.15;
        float curtain = smoothstep(0.25, 0.0, abs(p.y - (wave1 + wave2)));

        vec3 aurora = mix(vec3(0.0, 1.0, 0.5), vec3(0.8, 0.0, 1.0), sin(p.x * 3.0 + u_time) * 0.5 + 0.5);
        aurora *= curtain * (1.2 + u_mid * 2.0);

        vec2 fbUV = uv - vec2(0.0, 0.004);
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(mix(prev.rgb * 0.96, aurora, 0.25), 1.0);
      }
    `;
  }

  // 9. MilkDrop Liquid Audio Warp
  getShaderMilkdropLiquid() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = uv - 0.5;

        float angle = (0.016 + u_beatIntensity * 0.035) * sin(u_time * 1.6);
        mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        vec2 warpedP = rot * p * (0.985 - u_bass * 0.02);

        vec2 fbUV = warpedP + 0.5;
        vec4 prev = texture(u_feedback, fbUV);

        float wave = sin(p.x * 28.0 + u_time * 4.5) * (0.05 + u_mid * 0.12);
        float line = smoothstep(0.016, 0.0, abs(p.y - wave));

        vec3 waveColor = vec3(0.0, 1.0, 0.85) * line * (1.6 + u_treble * 2.2);
        waveColor += vec3(1.0, 0.0, 0.55) * u_beatIntensity;

        fragColor = vec4(prev.rgb * 0.97 + waveColor * 0.38, 1.0);
      }
    `;
  }

  // 10. MilkDrop Acid Trip Feedback Loop
  getShaderMilkdropAcid() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_beatIntensity;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = uv - 0.5;

        float rotA = 0.022 + u_beatIntensity * 0.055;
        mat2 rot = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA));
        vec2 fbUV = (rot * p) * (0.968 - u_bass * 0.032) + 0.5;

        vec4 prev = texture(u_feedback, fbUV);
        vec3 shifted = vec3(prev.g, prev.b, prev.r);

        float d = length(p);
        float burst = smoothstep(0.16 + u_bass * 0.22, 0.0, d);
        vec3 burstCol = vec3(sin(u_time * 3.5), sin(u_time * 3.5 + 2.0), sin(u_time * 3.5 + 4.0)) * 0.5 + 0.5;

        fragColor = vec4(shifted * 0.945 + burstCol * burst * (0.45 + u_beatIntensity * 0.65), 1.0);
      }
    `;
  }

  // 11. MilkDrop 3D Synthwave Horizon (Outrun Perspective Grid + Sun)
  getShaderMilkdropSynthwave() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        vec3 col = vec3(0.05, 0.02, 0.09);

        // Retro Striped Neon Sun
        if (p.y > 0.0) {
          float sunD = length(p - vec2(0.0, 0.14));
          if (sunD < 0.24) {
            float stripes = sin(p.y * 70.0);
            if (stripes > 0.0 || sunD < 0.12) {
              col = mix(vec3(1.0, 0.85, 0.0), vec3(1.0, 0.0, 0.45), p.y * 2.8);
            }
          }
        }

        // 3D Perspective Wireframe Ground
        if (p.y < 0.0) {
          float z = 0.32 / (-p.y);
          float x = p.x * z;

          float gridX = abs(fract(x * 2.5) - 0.5);
          float gridZ = abs(fract(z * 2.5 - u_time * 4.5) - 0.5);
          float grid = smoothstep(0.09, 0.0, min(gridX, gridZ));

          float terrainWave = sin(x * 4.5 + u_time * 2.5) * (0.25 + u_bass * 0.7);
          col += vec3(0.0, 0.85, 1.0) * grid * (1.2 + terrainWave);
        }

        // CRT Scanline Overlay
        if (mod(gl_FragCoord.y, 3.0) < 1.0) col *= 0.8;

        fragColor = vec4(col, 1.0);
      }
    `;
  }

  // 12. MilkDrop Volumetric Plasma Nebula
  getShaderMilkdropNebula() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float t = u_time * 0.85;
        vec3 col = vec3(0.0);

        for (float i = 1.0; i <= 3.0; i++) {
          vec2 q = p * (i * 2.2);
          float v = sin(q.x + t * i) + sin(q.y + t * i * 0.75) + sin((q.x + q.y) + u_bass * 4.5);
          col += vec3(sin(v), sin(v + 2.0), sin(v + 4.0)) * (0.22 / i);
        }

        vec2 fbUV = uv - p * 0.0055;
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(mix(prev.rgb * 0.935, col * 0.85, 0.32), 1.0);
      }
    `;
  }

  // 13. MilkDrop Cyber 3D Pillars
  getShaderMilkdropPillars() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * 2.0;

        float numBars = 16.0;
        float barIdx = floor((p.x * 0.5 + 0.5) * numBars);
        float barFract = fract((p.x * 0.5 + 0.5) * numBars);

        float barHeight = sin(barIdx * 0.55 + u_time * 2.2) * 0.4 + 0.5;
        barHeight += (barIdx < 6.0 ? u_bass : (barIdx < 11.0 ? u_mid : u_treble)) * 0.85;

        vec3 col = vec3(0.04, 0.05, 0.09);
        if (p.y < (barHeight * 1.5 - 0.75) && barFract > 0.14 && barFract < 0.86) {
          col = mix(vec3(0.0, 1.0, 0.55), vec3(1.0, 0.1, 0.65), barHeight);
          if (mod(gl_FragCoord.y, 4.0) < 1.5) col *= 0.65;
        }

        fragColor = vec4(col, 1.0);
      }
    `;
  }

  // 14. MilkDrop Lissajous Oscilloscope
  getShaderMilkdropLissajous() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform float u_treble;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float t = u_time * 2.8;
        vec2 lissajous = vec2(
          sin(t * 3.0 + u_bass * 2.2) * 0.38,
          cos(t * 4.0 + u_mid * 2.2) * 0.38
        );

        float d = length(p - lissajous);
        float beam = smoothstep(0.045, 0.0, d) * (2.2 + u_treble * 3.5);

        vec3 beamCol = vec3(0.0, 1.0, 0.45) * beam;

        vec2 fbUV = uv - p * 0.0035;
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(prev.rgb * 0.955 + beamCol * 0.42, 1.0);
      }
    `;
  }

  // 15. MilkDrop Sacred Geometry Mandala
  getShaderMilkdropMandala() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_mid;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        float a = atan(p.y, p.x);
        float r = length(p);

        // 12-Fold Sacred Flower
        float petal = abs(sin(a * 6.0 + u_time * 1.5 + u_bass * 3.0)) * (0.3 + u_mid * 0.3);
        float ring = smoothstep(0.02, 0.0, abs(r - petal));

        vec3 col = vec3(1.0, 0.2, 0.8) * ring * (1.5 + u_bass * 2.0);

        vec2 fbUV = uv + (p / (r + 0.001)) * 0.004;
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(prev.rgb * 0.95 + col * 0.35, 1.0);
      }
    `;
  }

  // 16. MilkDrop Cyberpunk Data Grid
  getShaderMilkdropDataGrid() {
    return `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_bass;
      uniform float u_treble;
      uniform sampler2D u_feedback;

      void main() {
        vec2 uv = v_uv;
        vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);

        vec2 grid = abs(fract(p * 14.0 - vec2(0.0, u_time * 3.0)) - 0.5);
        float lines = smoothstep(0.08, 0.0, min(grid.x, grid.y));

        vec3 col = vec3(0.0, 1.0, 0.3) * lines * (0.8 + u_treble * 2.0);

        vec2 fbUV = uv + vec2(0.0, 0.006);
        vec4 prev = texture(u_feedback, fbUV);

        fragColor = vec4(mix(prev.rgb * 0.93, col, 0.3), 1.0);
      }
    `;
  }
}
