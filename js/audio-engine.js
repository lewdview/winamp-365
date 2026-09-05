/**
 * ============================================================================
 * WINAMP 365 - WEB AUDIO API DSP ENGINE & SYNTHESIZER (v2.6 PRO)
 * Full 10-Band BiquadFilter EQ, Preamp, Stereo Pan, 2048-pt FFT Analyser,
 * Realtime Beat Detection, Same-Origin Audio Proxy Streaming,
 * and Procedural 365-Day Retro Synth Music Generator
 * ============================================================================
 */

export class WinampAudioEngine {
  constructor() {
    this.ctx = null;
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';
    this.audioElement.preload = 'auto';

    this.sourceNode = null;
    this.isSynthPlaying = false;
    this.synthInterval = null;

    // DSP Nodes
    this.preampNode = null;
    this.eqFilters = [];
    this.pannerNode = null;
    this.masterGainNode = null;
    this.analyserNode = null;

    // EQ Frequencies (Winamp 10-band standard)
    this.eqFrequencies = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    this.eqGains = new Array(10).fill(0); // dB (-12 to +12)
    this.preampGainVal = 0; // dB (-12 to +12)
    this.eqEnabled = true;

    // Analysis Buffers
    this.fftSize = 2048;
    this.freqData = null;
    this.timeData = null;

    // Beat Detection State
    this.energyHistory = [];
    this.historyLength = 43; // ~1 second of frames at 40-60fps
    this.beatThreshold = 1.35;
    this.lastBeatTime = 0;
    this.currentBeatIntensity = 0;

    // State
    this.volume = 0.8;
    this.pan = 0.0;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentTrack = null;

    // Callbacks
    this.onEnded = null;
    this.onTimeUpdate = null;
    this.onPlayStateChange = null;

    this.initAudioElementListeners();
  }

  initContext() {
    if (this.ctx) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();

    // 1. Create Preamp Gain
    this.preampNode = this.ctx.createGain();
    this.preampNode.gain.value = 1.0;

    // 2. Create 10-Band Graphic EQ Filters
    this.eqFilters = this.eqFrequencies.map((freq, idx) => {
      const filter = this.ctx.createBiquadFilter();
      if (idx === 0) {
        filter.type = 'lowshelf';
      } else if (idx === this.eqFrequencies.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.frequency.value = freq;
      filter.gain.value = 0;
      return filter;
    });

    // Chain EQ filters: preamp -> eq0 -> eq1 -> ... -> eq9
    this.preampNode.connect(this.eqFilters[0]);
    for (let i = 0; i < this.eqFilters.length - 1; i++) {
      this.eqFilters[i].connect(this.eqFilters[i + 1]);
    }

    // 3. Create Stereo Panner
    if (this.ctx.createStereoPanner) {
      this.pannerNode = this.ctx.createStereoPanner();
      this.pannerNode.pan.value = this.pan;
    } else {
      this.pannerNode = this.ctx.createGain();
    }
    this.eqFilters[this.eqFilters.length - 1].connect(this.pannerNode);

    // 4. Create Master Gain
    this.masterGainNode = this.ctx.createGain();
    this.masterGainNode.gain.value = this.volume;
    this.pannerNode.connect(this.masterGainNode);

    // 5. Create Analyser Node (2048 FFT)
    this.analyserNode = this.ctx.createAnalyser();
    this.analyserNode.fftSize = this.fftSize;
    this.analyserNode.smoothingTimeConstant = 0.8;
    this.masterGainNode.connect(this.analyserNode);

    // 6. Connect to Destination (Speakers)
    this.analyserNode.connect(this.ctx.destination);

    // Buffers for visualizers
    this.freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyserNode.frequencyBinCount);

    // Hook HTML5 Audio Element to Audio Graph
    try {
      this.sourceNode = this.ctx.createMediaElementSource(this.audioElement);
      this.sourceNode.connect(this.preampNode);
    } catch (e) {
      console.warn('Audio element source creation note:', e);
    }
  }

  ensureContextActive() {
    if (!this.ctx) {
      this.initContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  initAudioElementListeners() {
    this.audioElement.addEventListener('timeupdate', () => {
      if (this.onTimeUpdate) {
        this.onTimeUpdate({
          currentTime: this.audioElement.currentTime,
          duration: this.audioElement.duration || (this.currentTrack ? this.currentTrack.duration : 0)
        });
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this.isPaused = false;
      if (this.onEnded) this.onEnded();
      if (this.onPlayStateChange) this.onPlayStateChange(false);
    });

    this.audioElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.isPaused = false;
      if (this.onPlayStateChange) this.onPlayStateChange(true);
    });

    this.audioElement.addEventListener('pause', () => {
      if (!this.audioElement.ended) {
        this.isPaused = true;
      }
      if (this.onPlayStateChange) this.onPlayStateChange(false);
    });
  }

  // =========================================================================
  // Playback Controls with High-Performance Proxy Streaming
  // =========================================================================
  async playTrack(track) {
    this.ensureContextActive();
    this.stop();
    this.currentTrack = track;

    if (track.audioBlobUrl) {
      // 1. User local custom file override
      this.isSynthPlaying = false;
      this.audioElement.src = track.audioBlobUrl;
      try {
        await this.audioElement.play();
        this.isPlaying = true;
        this.isPaused = false;
        if (this.onPlayStateChange) this.onPlayStateChange(true);
        return;
      } catch (err) {
        console.warn('Local blob play error:', err);
      }
    } else if (track.audioSrc) {
      // 2. Official PIM CDN Audio (Route through local proxy for same-origin Web Audio compatibility)
      const proxyUrl = `/api/audio-proxy?url=${encodeURIComponent(track.audioSrc)}`;
      const directUrl = track.audioSrc;

      const candidates = [proxyUrl, directUrl];
      let playedSuccessfully = false;

      for (const candidate of candidates) {
        try {
          this.isSynthPlaying = false;
          this.audioElement.src = candidate;
          await this.audioElement.play();
          this.isPlaying = true;
          this.isPaused = false;
          playedSuccessfully = true;
          break;
        } catch (streamErr) {
          console.warn(`Audio stream failed for ${candidate}:`, streamErr.message);
        }
      }

      if (playedSuccessfully) {
        if (this.onPlayStateChange) this.onPlayStateChange(true);
        return;
      }
    }

    // 3. Fallback: Procedural 90s Vintage Synthesizer Engine
    console.log(`⚡ Streaming offline fallback synth for Day ${track.day || 1}...`);
    this.startProceduralSynth(track.day || 1);
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  pause() {
    if (this.isSynthPlaying) {
      this.stopProceduralSynth();
      this.isPaused = true;
      this.isPlaying = false;
    } else if (this.audioElement) {
      this.audioElement.pause();
      this.isPaused = true;
      this.isPlaying = false;
    }
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  resume() {
    this.ensureContextActive();
    if (this.isSynthPlaying || (this.currentTrack && !this.currentTrack.audioBlobUrl && !this.currentTrack.audioSrc)) {
      this.startProceduralSynth(this.currentTrack ? this.currentTrack.day : 1);
    } else if (this.audioElement && this.audioElement.src) {
      this.audioElement.play().catch(() => {
        this.startProceduralSynth(this.currentTrack ? this.currentTrack.day : 1);
      });
    }
  }

  stop() {
    this.stopProceduralSynth();
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
    this.isPlaying = false;
    this.isPaused = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  seekToPercent(percent) {
    const p = Math.max(0, Math.min(1, percent));
    if (this.audioElement && this.audioElement.duration && !this.isSynthPlaying) {
      this.audioElement.currentTime = p * this.audioElement.duration;
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGainNode && this.ctx) {
      const logGain = this.volume === 0 ? 0 : Math.pow(this.volume, 2);
      this.masterGainNode.gain.setTargetAtTime(logGain, this.ctx.currentTime, 0.02);
    }
    this.audioElement.volume = this.volume;
  }

  setPan(panVal) {
    this.pan = Math.max(-1, Math.min(1, panVal));
    if (this.pannerNode && this.pannerNode.pan && this.ctx) {
      this.pannerNode.pan.setTargetAtTime(this.pan, this.ctx.currentTime, 0.02);
    }
  }

  // =========================================================================
  // 10-Band Graphic Equalizer & Preamp
  // =========================================================================
  setPreamp(gainDb) {
    this.preampGainVal = Math.max(-12, Math.min(12, gainDb));
    if (this.preampNode && this.ctx) {
      const linear = Math.pow(10, this.preampGainVal / 20);
      this.preampNode.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.02);
    }
  }

  setEQBand(bandIndex, gainDb) {
    if (bandIndex < 0 || bandIndex >= this.eqFrequencies.length) return;
    this.eqGains[bandIndex] = Math.max(-12, Math.min(12, gainDb));
    if (this.eqFilters[bandIndex] && this.ctx) {
      const g = this.eqEnabled ? this.eqGains[bandIndex] : 0;
      this.eqFilters[bandIndex].gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
    }
  }

  toggleEQ(enabled) {
    this.eqEnabled = enabled !== undefined ? enabled : !this.eqEnabled;
    this.eqFilters.forEach((filter, idx) => {
      const g = this.eqEnabled ? this.eqGains[idx] : 0;
      if (this.ctx) {
        filter.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
      }
    });
    return this.eqEnabled;
  }

  applyPreset(gainsArray, preamp = 0) {
    if (Array.isArray(gainsArray) && gainsArray.length === 10) {
      this.setPreamp(preamp);
      gainsArray.forEach((gain, idx) => this.setEQBand(idx, gain));
    }
  }

  // =========================================================================
  // Real-time Audio Spectrum & Beat Detection
  // =========================================================================
  getAudioAnalysis() {
    if (!this.analyserNode) {
      return {
        freqData: new Uint8Array(128),
        timeData: new Uint8Array(128),
        bassEnergy: 0,
        midEnergy: 0,
        trebleEnergy: 0,
        beat: false,
        beatIntensity: 0,
        spectralCentroid: 0
      };
    }

    this.analyserNode.getByteFrequencyData(this.freqData);
    this.analyserNode.getByteTimeDomainData(this.timeData);

    const binCount = this.freqData.length;
    const bassEnd = Math.floor(binCount * 0.06);
    const midEnd = Math.floor(binCount * 0.35);

    let bassSum = 0;
    for (let i = 0; i < bassEnd; i++) bassSum += this.freqData[i];
    const bassEnergy = bassSum / (bassEnd * 255);

    let midSum = 0;
    for (let i = bassEnd; i < midEnd; i++) midSum += this.freqData[i];
    const midEnergy = midSum / ((midEnd - bassEnd) * 255);

    let trebSum = 0;
    for (let i = midEnd; i < binCount; i++) trebSum += this.freqData[i];
    const trebleEnergy = trebSum / ((binCount - midEnd) * 255);

    const now = performance.now();
    let isBeat = false;

    this.energyHistory.push(bassEnergy);
    if (this.energyHistory.length > this.historyLength) {
      this.energyHistory.shift();
    }

    let avgEnergy = 0;
    for (let i = 0; i < this.energyHistory.length; i++) {
      avgEnergy += this.energyHistory[i];
    }
    avgEnergy /= (this.energyHistory.length || 1);

    let variance = 0;
    for (let i = 0; i < this.energyHistory.length; i++) {
      variance += Math.pow(this.energyHistory[i] - avgEnergy, 2);
    }
    variance /= (this.energyHistory.length || 1);

    const dynamicThreshold = (-15 * variance) + this.beatThreshold;

    if (bassEnergy > avgEnergy * dynamicThreshold && (now - this.lastBeatTime > 240) && bassEnergy > 0.25) {
      isBeat = true;
      this.lastBeatTime = now;
      this.currentBeatIntensity = Math.min(1.0, (bassEnergy - avgEnergy) * 2.5);
    } else {
      this.currentBeatIntensity *= 0.92;
    }

    return {
      freqData: this.freqData,
      timeData: this.timeData,
      bassEnergy,
      midEnergy,
      trebleEnergy,
      beat: isBeat,
      beatIntensity: this.currentBeatIntensity,
      spectralCentroid: (bassEnergy * 0.2) + (midEnergy * 0.5) + (trebleEnergy * 1.0)
    };
  }

  // =========================================================================
  // Procedural 365-Day Nostalgic 90s Synth & Chiptune Generator
  // =========================================================================
  startProceduralSynth(dayNumber = 1) {
    this.ensureContextActive();
    this.stopProceduralSynth();
    this.isSynthPlaying = true;
    this.isPlaying = true;
    this.isPaused = false;

    let seed = (dayNumber * 9301 + 49297) % 233280;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    const rootNotes = [130.81, 146.83, 164.81, 174.61, 196.00, 220.00, 246.94];
    const rootFreq = rootNotes[Math.floor(rnd() * rootNotes.length)];
    const scales = [
      [0, 3, 5, 7, 10, 12, 15, 17, 19],
      [0, 2, 3, 5, 7, 9, 10, 12, 14, 15],
      [0, 2, 3, 5, 7, 8, 10, 12, 14, 15]
    ];
    const scale = scales[Math.floor(rnd() * scales.length)];
    const bpm = 110 + Math.floor(rnd() * 32);
    const stepDuration = 60 / bpm / 4;

    const synthBus = this.ctx.createGain();
    synthBus.gain.value = 0.7;
    synthBus.connect(this.preampNode);

    const masterFilter = this.ctx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 2200 + rnd() * 3000;
    masterFilter.Q.value = 4.0;
    synthBus.connect(masterFilter);
    masterFilter.connect(this.preampNode);

    let step = 0;
    let synthTimer = 0;
    const duration = 210;

    this.synthInterval = setInterval(() => {
      if (!this.isSynthPlaying || !this.ctx) return;
      const t = this.ctx.currentTime;
      synthTimer += stepDuration;

      if (this.onTimeUpdate) {
        this.onTimeUpdate({
          currentTime: synthTimer % duration,
          duration: duration
        });
      }

      if (step % 4 === 0) {
        const kickOsc = this.ctx.createOscillator();
        const kickGain = this.ctx.createGain();
        kickOsc.frequency.setValueAtTime(140, t);
        kickOsc.frequency.exponentialRampToValueAtTime(32, t + 0.12);
        kickGain.gain.setValueAtTime(0.9, t);
        kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        kickOsc.connect(kickGain);
        kickGain.connect(this.preampNode);
        kickOsc.start(t);
        kickOsc.stop(t + 0.2);
      }

      if (step % 8 === 4) {
        const snareOsc = this.ctx.createOscillator();
        const snareGain = this.ctx.createGain();
        snareOsc.type = 'triangle';
        snareOsc.frequency.setValueAtTime(220, t);
        snareGain.gain.setValueAtTime(0.4, t);
        snareGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        snareOsc.connect(snareGain);
        snareGain.connect(this.preampNode);
        snareOsc.start(t);
        snareOsc.stop(t + 0.15);
      }

      if (step % 2 === 0) {
        const hatOsc = this.ctx.createOscillator();
        const hatGain = this.ctx.createGain();
        hatOsc.type = 'square';
        hatOsc.frequency.setValueAtTime(6000 + (step % 4 === 2 ? 2000 : 0), t);
        hatGain.gain.setValueAtTime(0.08, t);
        hatGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        hatOsc.connect(hatGain);
        hatGain.connect(this.preampNode);
        hatOsc.start(t);
        hatOsc.stop(t + 0.05);
      }

      if (step % 2 === 0 || (step % 4 === 3 && rnd() > 0.4)) {
        const semitone = scale[(step / 2) % scale.length];
        const bassFreq = (rootFreq / 2) * Math.pow(2, semitone / 12);
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bassOsc.type = 'sawtooth';
        bassOsc.frequency.setValueAtTime(bassFreq, t);
        bassGain.gain.setValueAtTime(0.35, t);
        bassGain.gain.exponentialRampToValueAtTime(0.01, t + stepDuration * 1.5);
        bassOsc.connect(bassGain);
        bassGain.connect(masterFilter);
        bassOsc.start(t);
        bassOsc.stop(t + stepDuration * 2);
      }

      if (rnd() > 0.25) {
        const arpDegree = scale[(step * 3 + (dayNumber % 5)) % scale.length];
        const leadFreq = rootFreq * 2 * Math.pow(2, arpDegree / 12);
        const leadOsc = this.ctx.createOscillator();
        const leadGain = this.ctx.createGain();
        leadOsc.type = (dayNumber % 2 === 0) ? 'square' : 'sawtooth';
        leadOsc.frequency.setValueAtTime(leadFreq, t);
        leadGain.gain.setValueAtTime(0.18, t);
        leadGain.gain.exponentialRampToValueAtTime(0.001, t + stepDuration * 1.8);
        leadOsc.connect(leadGain);
        leadGain.connect(masterFilter);
        leadOsc.start(t);
        leadOsc.stop(t + stepDuration * 2);
      }

      masterFilter.frequency.setTargetAtTime(1400 + Math.sin(step * 0.15) * 1200, t, 0.05);
      step = (step + 1) % 64;
    }, stepDuration * 1000);
  }

  stopProceduralSynth() {
    this.isSynthPlaying = false;
    if (this.synthInterval) {
      clearInterval(this.synthInterval);
      this.synthInterval = null;
    }
  }
}
