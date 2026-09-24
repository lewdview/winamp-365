/**
 * ============================================================================
 * WINAMP 365 - MAIN CONTROLLER & PIM ECOSYSTEM INTEGRATION (v2.5 PRO)
 * Connects directly to PIM 365-Song Catalog, streaming official master audio,
 * Cover Art inspect, Day-Locking, 10-Band EQ, and MilkDrop/Geiss Visualizers.
 * ============================================================================
 */

import { WinampAudioEngine } from './audio-engine.js';
import { DayLockManager } from './day-lock-manager.js';
import { PlaylistManager } from './playlist-manager.js';
import { WindowManager } from './window-manager.js';
import { WinampVisualizerEngine } from './visualizer-engine.js';

class Winamp365App {
  constructor() {
    this.dayLock = new DayLockManager();
    this.playlist = new PlaylistManager(this.dayLock);
    this.audio = new WinampAudioEngine();
    this.windowManager = new WindowManager();
    this.visualizer = new WinampVisualizerEngine(this.audio);

    this.isElapsedMode = true;
    this.isShuffle = false;
    this.isRepeat = false;
    this.isScrubbing = false;

    // EQ Preset definitions
    this.eqPresets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      club: [0, 0, 2, 4, 4, 4, 2, 0, 0, 0],
      rock: [6, 4, -2, -3, 1, 3, 6, 7, 7, 7],
      pop: [-1, 1, 4, 5, 4, 1, -1, -2, -2, -2],
      techno: [6, 5, 0, -4, -3, 0, 6, 8, 8, 7],
      dance: [7, 6, 2, 0, 0, -3, 5, 6, 6, 0],
      reggae: [0, 0, -1, -5, 0, 5, 5, 1, 0, 0],
      classical: [4, 3, 2, 2, -1, -1, 0, 2, 3, 3],
      fullbass: [8, 8, 7, 3, -1, -4, 1, 6, 8, 8],
      vocal: [-2, -3, -3, 1, 6, 6, 4, 2, 0, -2],
      synthwave: [7, 5, 3, 1, 0, 2, 4, 6, 7, 8]
    };
  }

  async init() {
    console.log('⚡ Initializing Winamp 365 with PIM 365-Song Database...');

    // 1. Init Window System & Docking
    this.windowManager.init();

    // 2. Init Storage & Load PIM Song Database
    await this.playlist.initStorage();

    // 3. Init Visualizers
    const visCanvas = document.getElementById('vis-canvas');
    const miniVisCanvas = document.getElementById('mini-vis-canvas');
    this.visualizer.init(visCanvas, miniVisCanvas);

    // 4. Select Initial Track (Today's track by default)
    const today = this.dayLock.getCurrentDay();
    this.playlist.selectTrackByDay(today);

    // 5. Bind UI Events & Listeners
    this.bindAudioListeners();
    this.bindTransportControls();
    this.bindEqualizerControls();
    this.bindDSPControls();
    this.bindPlaylistControls();
    this.bindVisualizerControls();
    this.bindDayLockModal();
    this.bindImporterModal();
    this.bindSongInfoModal();
    this.bindKeyboardShortcuts();
    this.bindSkinSelector();
    this.bindLayoutReset();

    // 6. Initial UI Render
    this.updateHeaderStats();
    this.renderPlaylist();
    this.updateTrackInfoUI();
    this.drawEQCurve();
    this.populateVisPresetDropdown();

    // Start header countdown interval
    setInterval(() => this.updateHeaderStats(), 1000);

    const cur = this.playlist.getCurrentTrack();
    this.showToast(`⚡ Seeded with 365 PIM Songs! Today: Day ${today} "${cur.title}"`);
  }

  // =========================================================================
  // Audio Engine Callbacks & UI Sync
  // =========================================================================
  bindAudioListeners() {
    this.audio.onTimeUpdate = ({ currentTime, duration }) => {
      if (this.isScrubbing) return;

      const timeDisplay = document.getElementById('lcd-time');
      const modeDisplay = document.getElementById('lcd-mode-toggle');

      if (this.isElapsedMode) {
        modeDisplay.textContent = 'ELAPSED';
        timeDisplay.textContent = this.formatLCDTime(currentTime);
      } else {
        modeDisplay.textContent = 'REMAIN';
        const remaining = Math.max(0, (duration || 180) - currentTime);
        timeDisplay.textContent = `-${this.formatLCDTime(remaining)}`;
      }

      const scrubFill = document.getElementById('scrub-fill');
      const scrubThumb = document.getElementById('scrub-thumb');
      const d = duration || (this.playlist.getCurrentTrack().duration || 180);
      const percent = Math.min(100, Math.max(0, (currentTime / d) * 100));

      if (scrubFill) scrubFill.style.width = `${percent}%`;
      if (scrubThumb) scrubThumb.style.left = `${percent}%`;
    };

    this.audio.onEnded = () => {
      this.playNextTrack();
    };

    this.audio.onRequestNextTrack = (crossfade) => {
      this.playNextTrack(crossfade);
    };

    this.audio.onCrossfadeProgress = (progressDir) => {
      const fader = document.getElementById('crossfader-fader');
      const tag = document.getElementById('dj-status-badge');
      if (fader) {
        const pct = Math.min(100, Math.max(0, ((progressDir + 1) / 2) * 100));
        fader.style.left = `${pct}%`;
      }
      if (tag) {
        const isMixing = Math.abs(progressDir) < 0.95;
        tag.textContent = isMixing ? 'MIXING' : 'READY';
        tag.style.color = isMixing ? '#ffaa00' : '#00ff55';
      }
    };

    this.audio.onPlayStateChange = (isPlaying) => {
      const playBtn = document.getElementById('btn-play');
      const pauseBtn = document.getElementById('btn-pause');

      if (isPlaying) {
        playBtn.classList.add('active-play');
        pauseBtn.classList.remove('active-play');
      } else {
        playBtn.classList.remove('active-play');
        if (this.audio.isPaused) pauseBtn.classList.add('active-play');
        else pauseBtn.classList.remove('active-play');
      }

      this.renderPlaylist();
    };
  }

  // =========================================================================
  // Transport Controls
  // =========================================================================
  bindTransportControls() {
    const playBtn = document.getElementById('btn-play');
    const pauseBtn = document.getElementById('btn-pause');
    const stopBtn = document.getElementById('btn-stop');
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const ejectBtn = document.getElementById('btn-eject');
    const shuffleBtn = document.getElementById('btn-shuffle');
    const repeatBtn = document.getElementById('btn-repeat');
    const lcdModeToggle = document.getElementById('lcd-mode-toggle');
    const miniVisCanvas = document.getElementById('mini-vis-canvas');

    playBtn.addEventListener('click', () => this.playCurrentTrack());
    pauseBtn.addEventListener('click', () => {
      if (this.audio.isPlaying) this.audio.pause();
      else this.audio.resume();
    });
    stopBtn.addEventListener('click', () => {
      this.audio.stop();
      document.getElementById('lcd-time').textContent = '00:00';
      document.getElementById('scrub-fill').style.width = '0%';
      document.getElementById('scrub-thumb').style.left = '0%';
    });
    prevBtn.addEventListener('click', () => this.playPrevTrack());
    nextBtn.addEventListener('click', () => this.playNextTrack());

    ejectBtn.addEventListener('click', () => {
      this.openSongInfoModal();
    });

    shuffleBtn.addEventListener('click', () => {
      this.isShuffle = !this.isShuffle;
      shuffleBtn.classList.toggle('active', this.isShuffle);
      this.showToast(this.isShuffle ? '🔀 Shuffle Mode ON' : 'Shuffle Mode OFF');
    });

    repeatBtn.addEventListener('click', () => {
      this.isRepeat = !this.isRepeat;
      repeatBtn.classList.toggle('active', this.isRepeat);
      this.showToast(this.isRepeat ? '🔁 Repeat Mode ON' : 'Repeat Mode OFF');
    });

    lcdModeToggle.addEventListener('click', () => {
      this.isElapsedMode = !this.isElapsedMode;
      lcdModeToggle.textContent = this.isElapsedMode ? 'ELAPSED' : 'REMAIN';
    });

    miniVisCanvas.addEventListener('click', () => {
      const mode = this.visualizer.toggleMiniVisMode();
      this.showToast(`Mini Visualizer: ${mode.toUpperCase()}`);
    });

    // Scrub Bar seek
    const scrubBar = document.getElementById('scrub-bar');
    scrubBar.addEventListener('click', (e) => {
      const rect = scrubBar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = clickX / rect.width;
      this.audio.seekToPercent(percent);
    });

    // Volume Slider
    const volSlider = document.getElementById('vol-slider');
    const volReadout = document.getElementById('vol-readout');
    volSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.audio.setVolume(val / 100);
      volReadout.textContent = `${val}%`;
    });

    // Pan / Balance Slider
    const panSlider = document.getElementById('pan-slider');
    const panReadout = document.getElementById('pan-readout');
    panSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.audio.setPan(val / 100);
      if (val === 0) panReadout.textContent = 'C';
      else if (val < 0) panReadout.textContent = `${Math.abs(val)}L`;
      else panReadout.textContent = `${val}R`;
    });

    // Window Toggles
    document.getElementById('toggle-eq-btn').addEventListener('click', (e) => {
      this.windowManager.toggleWindow('window-eq');
      e.target.classList.toggle('active');
    });
    document.getElementById('toggle-pl-btn').addEventListener('click', (e) => {
      this.windowManager.toggleWindow('window-playlist');
      e.target.classList.toggle('active');
    });
    document.getElementById('toggle-vis-btn').addEventListener('click', (e) => {
      this.windowManager.toggleWindow('window-visualizer');
      e.target.classList.toggle('active');
    });

    const toggleDspBtn = document.getElementById('toggle-dsp-btn');
    if (toggleDspBtn) {
      toggleDspBtn.addEventListener('click', (e) => {
        this.windowManager.toggleWindow('window-dsp');
        e.target.classList.toggle('active');
      });
    }

    const toggleDspHdr = document.getElementById('btn-toggle-dsp-hdr');
    if (toggleDspHdr) {
      toggleDspHdr.addEventListener('click', () => {
        this.windowManager.toggleWindow('window-dsp');
        if (toggleDspBtn) toggleDspBtn.classList.toggle('active');
      });
    }
  }

  // =========================================================================
  // Equalizer Controls & Curve Rendering
  // =========================================================================
  bindEqualizerControls() {
    const powerToggle = document.getElementById('eq-power-toggle');
    const powerLed = document.getElementById('eq-power-led');
    powerToggle.addEventListener('click', () => {
      const state = this.audio.toggleEQ();
      powerLed.classList.toggle('on', state);
      this.drawEQCurve();
      this.showToast(`Equalizer: ${state ? 'ENABLED' : 'BYPASSED'}`);
    });

    const preampSlider = document.getElementById('eq-preamp-slider');
    preampSlider.addEventListener('input', (e) => {
      this.audio.setPreamp(parseFloat(e.target.value));
      this.drawEQCurve();
    });

    const bandSliders = document.querySelectorAll('.eq-band-slider');
    bandSliders.forEach(slider => {
      slider.addEventListener('input', (e) => {
        const band = parseInt(e.target.getAttribute('data-band'), 10);
        const gain = parseFloat(e.target.value);
        this.audio.setEQBand(band, gain);
        this.drawEQCurve();
      });
    });

    // Presets Dropdown
    const presetsBtn = document.getElementById('btn-eq-presets');
    const presetsMenu = document.getElementById('eq-presets-menu');

    presetsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      presetsMenu.classList.toggle('open');
    });

    document.addEventListener('click', () => presetsMenu.classList.remove('open'));

    document.querySelectorAll('.eq-preset-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const presetKey = e.target.getAttribute('data-preset');
        const gains = this.eqPresets[presetKey];
        if (gains) {
          this.audio.applyPreset(gains, 0);
          preampSlider.value = 0;
          bandSliders.forEach((s, idx) => {
            s.value = gains[idx];
          });
          this.drawEQCurve();
          this.showToast(`EQ Preset: ${e.target.textContent}`);
        }
        presetsMenu.classList.remove('open');
      });
    });
  }

  drawEQCurve() {
    const canvas = document.getElementById('eq-curve-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = 220;
    const h = canvas.height = 56;

    ctx.clearRect(0, 0, w, h);

    if (!this.audio.eqEnabled) return;

    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 6;

    ctx.beginPath();
    const gains = this.audio.eqGains;
    const numPoints = gains.length;

    for (let i = 0; i < numPoints; i++) {
      const x = (i / (numPoints - 1)) * (w - 10) + 5;
      const normalized = (gains[i] + 12) / 24;
      const y = h - 4 - normalized * (h - 8);

      if (i === 0) ctx.moveTo(x, y);
      else {
        const prevX = ((i - 1) / (numPoints - 1)) * (w - 10) + 5;
        const prevGain = gains[i - 1];
        const prevY = h - 4 - ((prevGain + 12) / 24) * (h - 8);
        const cpX1 = prevX + (x - prevX) / 2;
        const cpX2 = cpX1;
        ctx.bezierCurveTo(cpX1, prevY, cpX2, y, x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // =========================================================================
  // DSP Effects Studio & Auto-DJ Controls
  // =========================================================================
  bindDSPControls() {
    // 1. Power / Master Bypass Toggle
    const powerBtn = document.getElementById('dsp-power-toggle');
    const powerLed = document.getElementById('dsp-power-led');
    if (powerBtn && powerLed) {
      powerBtn.addEventListener('click', () => {
        const state = this.audio.toggleDSP();
        powerLed.classList.toggle('on', state);
        powerBtn.textContent = state ? 'ON' : 'OFF';
        this.showToast(`DSP Studio Effects: ${state ? 'ENABLED' : 'BYPASSED'}`);
      });
    }

    // 2. Preset Selector
    const presetSelect = document.getElementById('dsp-preset-select');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const p = this.audio.applyDSPPreset(e.target.value);
        const speedSlider = document.getElementById('dsp-speed-slider');
        const speedReadout = document.getElementById('speed-readout');
        if (speedSlider) speedSlider.value = Math.round(p.speed * 100);
        if (speedReadout) speedReadout.textContent = `${p.speed.toFixed(2)}x`;

        const bassSlider = document.getElementById('dsp-bass-slider');
        const bassReadout = document.getElementById('bass-readout');
        if (bassSlider) bassSlider.value = p.bass;
        if (bassReadout) bassReadout.textContent = `+${p.bass}dB`;

        const satSlider = document.getElementById('dsp-sat-slider');
        const satReadout = document.getElementById('sat-readout');
        if (satSlider) satSlider.value = p.sat;
        if (satReadout) satReadout.textContent = `${p.sat}%`;

        const widthSlider = document.getElementById('dsp-width-slider');
        const widthReadout = document.getElementById('width-readout');
        if (widthSlider) widthSlider.value = p.width;
        if (widthReadout) widthReadout.textContent = `${p.width}%`;

        const reverbSlider = document.getElementById('dsp-reverb-slider');
        const reverbReadout = document.getElementById('reverb-readout');
        if (reverbSlider) reverbSlider.value = p.revMix;
        if (reverbReadout) reverbReadout.textContent = `${p.revMix}%`;

        this.showToast(`DSP Preset: ${e.target.options[e.target.selectedIndex].text}`);
      });
    }

    // 3. Playback Speed Slider
    const speedSlider = document.getElementById('dsp-speed-slider');
    const speedReadout = document.getElementById('speed-readout');
    if (speedSlider && speedReadout) {
      speedSlider.addEventListener('input', (e) => {
        const speed = parseInt(e.target.value, 10) / 100;
        this.audio.setPlaybackSpeed(speed);
        speedReadout.textContent = `${speed.toFixed(2)}x`;
      });
    }

    // Reset Speed Button
    const resetSpeedBtn = document.getElementById('btn-reset-speed');
    if (resetSpeedBtn && speedSlider && speedReadout) {
      resetSpeedBtn.addEventListener('click', () => {
        speedSlider.value = 100;
        this.audio.setPlaybackSpeed(1.0);
        speedReadout.textContent = '1.00x';
        this.showToast('Playback Speed: Reset to 1.00x');
      });
    }

    // 4. Pitch Mode Toggle (Preserve Pitch vs Tape/Vinyl Varipitch)
    const pitchToggleBtn = document.getElementById('btn-pitch-mode');
    const pitchModeLabel = document.getElementById('pitch-mode-label');
    if (pitchToggleBtn && pitchModeLabel) {
      pitchToggleBtn.addEventListener('click', () => {
        const newMode = !this.audio.preservePitch;
        this.audio.setPitchMode(newMode);
        pitchToggleBtn.classList.toggle('active', newMode);
        pitchModeLabel.textContent = newMode ? 'PITCH: TIME STRETCH' : 'PITCH: TAPE VARICLIP';
        this.showToast(newMode ? 'Pitch Mode: Time-Stretch (Preserve Key)' : 'Pitch Mode: Tape / Vinyl Variclip');
      });
    }

    // 5. Vinyl Motor Brake Button
    const vinylBrakeBtn = document.getElementById('btn-vinyl-brake');
    if (vinylBrakeBtn) {
      vinylBrakeBtn.addEventListener('click', () => {
        const isBraking = this.audio.triggerVinylBrake();
        vinylBrakeBtn.classList.toggle('active', isBraking);
        if (isBraking) {
          this.showToast('🛑 Vinyl Brake: Motor Slowing Down...');
        } else {
          this.showToast('⚡ Vinyl Brake: Motor Spinning Up!');
        }
      });
    }

    // 6. Reverb Wet/Dry Mix Slider
    const reverbSlider = document.getElementById('dsp-reverb-slider');
    const reverbReadout = document.getElementById('reverb-readout');
    if (reverbSlider && reverbReadout) {
      reverbSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.audio.setReverbMix(val);
        reverbReadout.textContent = `${val}%`;
      });
    }

    // 7. 3D Spatial Stereo Width Slider
    const widthSlider = document.getElementById('dsp-width-slider');
    const widthReadout = document.getElementById('width-readout');
    if (widthSlider && widthReadout) {
      widthSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.audio.setStereoWidth(val);
        widthReadout.textContent = `${val}%`;
      });
    }

    // 8. 55Hz Sub-Bass Exciter Slider
    const bassSlider = document.getElementById('dsp-bass-slider');
    const bassReadout = document.getElementById('bass-readout');
    if (bassSlider && bassReadout) {
      bassSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.audio.setBassExciter(val);
        bassReadout.textContent = `+${val}dB`;
      });
    }

    // 9. Tape / Tube Saturation Drive Slider
    const satSlider = document.getElementById('dsp-sat-slider');
    const satReadout = document.getElementById('sat-readout');
    if (satSlider && satReadout) {
      satSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.audio.setSaturation(val);
        satReadout.textContent = `${val}%`;
      });
    }

    // 10. Auto-DJ "Through & Through" Mode Toggle
    const autoDjBtn = document.getElementById('btn-toggle-autodj');
    const autoDjLed = document.getElementById('autodj-led');
    if (autoDjBtn && autoDjLed) {
      autoDjBtn.addEventListener('click', () => {
        const isAuto = this.audio.toggleAutoDJ();
        autoDjBtn.classList.toggle('active', isAuto);
        autoDjLed.classList.toggle('on', isAuto);
        this.showToast(isAuto ? '🎧 Auto-DJ: Play Through & Through ENABLED' : 'Auto-DJ: Manual Track End');
      });
    }

    // 11. Crossfade Duration Slider
    const crossfadeSlider = document.getElementById('dsp-crossfade-slider');
    const crossfadeReadout = document.getElementById('crossfade-readout');
    if (crossfadeSlider && crossfadeReadout) {
      crossfadeSlider.addEventListener('input', (e) => {
        const dur = (parseInt(e.target.value, 10) / 10).toFixed(1);
        this.audio.setCrossfadeDuration(parseFloat(dur));
        crossfadeReadout.textContent = `${dur}s`;
      });
    }
  }

  // =========================================================================
  // Playlist Controls & Rendering (PIM 365 Data)
  // =========================================================================
  bindPlaylistControls() {
    document.querySelectorAll('.pl-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.pl-tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.playlist.activeFilter = e.target.getAttribute('data-filter');
        this.renderPlaylist();
      });
    });

    const searchInput = document.getElementById('pl-search-input');
    searchInput.addEventListener('input', (e) => {
      this.playlist.searchQuery = e.target.value;
      this.renderPlaylist();
    });

    document.getElementById('pl-btn-info').addEventListener('click', () => {
      this.openSongInfoModal();
    });

    document.getElementById('pl-btn-add-file').addEventListener('click', () => {
      document.getElementById('file-input-multiple').click();
    });
    document.getElementById('pl-btn-add-dir').addEventListener('click', () => {
      document.getElementById('file-input-dir').click();
    });
    document.getElementById('pl-btn-time-machine').addEventListener('click', () => {
      document.getElementById('modal-time-machine').classList.add('open');
      this.renderCalendarGrid();
    });
    document.getElementById('pl-btn-clear').addEventListener('click', async () => {
      if (confirm('Reset custom overrides back to official PIM 365 catalog?')) {
        await this.playlist.clearAudioStorage();
        this.renderPlaylist();
        this.showToast('Reverted to official PIM 365 songs.');
      }
    });
  }

  renderPlaylist() {
    const listContainer = document.getElementById('playlist-tracklist');
    if (!listContainer) return;

    const filtered = this.playlist.getFilteredTracks();
    const currentTrack = this.playlist.getCurrentTrack();
    const today = this.dayLock.getCurrentDay();

    listContainer.innerHTML = '';

    if (filtered.length === 0) {
      listContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: #667;">No PIM tracks match the current filter.</div>`;
      return;
    }

    filtered.forEach(track => {
      const isUnlocked = this.dayLock.isDayUnlocked(track.day);
      const isCurrent = currentTrack && currentTrack.day === track.day;
      const isToday = track.day === today;

      const row = document.createElement('div');
      row.className = 'playlist-track-row';
      if (isCurrent) row.classList.add('active-playing');
      if (isToday) row.classList.add('today-spotlight');
      if (!isUnlocked) row.classList.add('track-locked');

      const lockIcon = isUnlocked ? '🔓' : '🔒';
      const customTag = track.hasCustomAudio ? '🎵 ' : '⚡ ';
      const bpmTag = track.bpm ? ` [${track.bpm}BPM]` : '';

      row.innerHTML = `
        <div class="track-day-col">#${track.day.toString().padStart(3, '0')}</div>
        <div class="track-lock-col" title="${isUnlocked ? 'Unlocked' : 'Locked until ' + track.dateStr}">${lockIcon}</div>
        <div class="track-title-col" title="${track.title} by ${track.artist} (${track.genre.join(', ')})">${customTag}${track.title}${bpmTag}</div>
        <div class="track-duration-col">${track.durationStr}</div>
      `;

      row.addEventListener('click', () => {
        if (!isUnlocked) {
          this.showToast(`🔒 Day ${track.day} "${track.title}" unlocks on ${track.dateStr}!`, 'warn');
          return;
        }
        this.playlist.selectTrackByDay(track.day);
        this.playCurrentTrack();
      });

      listContainer.appendChild(row);
    });

    const stats = this.dayLock.getStats();
    document.getElementById('pl-stats').textContent = `${stats.unlockedCount}/365 Unlocked (${stats.percent}%)`;

    // Auto-scroll active track into view
    const activeRow = listContainer.querySelector('.playlist-track-row.active-playing') || listContainer.querySelector('.playlist-track-row.today-spotlight');
    if (activeRow) {
      setTimeout(() => {
        activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 50);
    }
  }

  // =========================================================================
  // PIM Song Info & Cover Art Modal
  // =========================================================================
  bindSongInfoModal() {
    const openBtn = document.getElementById('btn-open-song-info');
    const modal = document.getElementById('modal-song-info');
    const closeBtns = modal.querySelectorAll('.modal-close-btn');
    const playNowBtn = document.getElementById('info-btn-play-now');

    openBtn.addEventListener('click', () => this.openSongInfoModal());

    closeBtns.forEach(b => b.addEventListener('click', () => modal.classList.remove('open')));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });

    playNowBtn.addEventListener('click', () => {
      modal.classList.remove('open');
      this.playCurrentTrack();
    });
  }

  openSongInfoModal(track = null) {
    const targetTrack = track || this.playlist.getCurrentTrack();
    if (!targetTrack) return;

    const modal = document.getElementById('modal-song-info');
    const isUnlocked = this.dayLock.isDayUnlocked(targetTrack.day);

    document.getElementById('info-modal-header-title').textContent = `Day ${targetTrack.day} - PIM Song Details`;
    document.getElementById('info-title').textContent = targetTrack.title;
    document.getElementById('info-artist').textContent = `By ${targetTrack.artist} • ${targetTrack.dateStr}`;
    document.getElementById('info-day-tag').textContent = `PIM Day ${targetTrack.day} of 365 [${targetTrack.dateStr}]`;
    document.getElementById('info-bpm').textContent = targetTrack.bpm || 120;
    document.getElementById('info-key').textContent = targetTrack.key || 'C major';
    document.getElementById('info-genre').textContent = Array.isArray(targetTrack.genre) ? targetTrack.genre.join(', ') : targetTrack.genre;
    document.getElementById('info-status').textContent = isUnlocked ? '🔓 Unlocked' : '🔒 Day Locked';
    document.getElementById('info-status').style.color = isUnlocked ? '#00ff55' : '#ffaa00';
    document.getElementById('info-description').textContent = targetTrack.description || (targetTrack.moodTags ? targetTrack.moodTags.join(', ') : 'PIM Official Track');

    const coverImg = document.getElementById('info-cover-img');
    if (targetTrack.coverArt) {
      coverImg.src = targetTrack.coverArt;
      coverImg.style.display = 'block';
    } else {
      coverImg.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="%231a1b24"/><text x="100" y="105" fill="%2300e5ff" font-family="sans-serif" font-size="28" font-weight="bold" text-anchor="middle">DAY ${targetTrack.day}</text></svg>`;
    }

    modal.classList.add('open');
  }

  // =========================================================================
  // Visualizer Controls & HUD
  // =========================================================================
  bindVisualizerControls() {
    const prevBtn = document.getElementById('vis-prev-btn');
    const nextBtn = document.getElementById('vis-next-btn');
    const cycleBtn = document.getElementById('vis-cycle-btn');
    const fullBtn = document.getElementById('vis-fullscreen-btn');
    const presetSelect = document.getElementById('vis-preset-select');

    prevBtn.addEventListener('click', () => {
      const preset = this.visualizer.prevPreset();
      this.updateVisHUD(preset);
    });

    nextBtn.addEventListener('click', () => {
      const preset = this.visualizer.nextPreset();
      this.updateVisHUD(preset);
    });

    cycleBtn.addEventListener('click', () => {
      this.visualizer.autoCycle = !this.visualizer.autoCycle;
      cycleBtn.textContent = `AUTO: ${this.visualizer.autoCycle ? 'ON' : 'OFF'}`;
      this.showToast(`Visualizer Auto-Cycle: ${this.visualizer.autoCycle ? 'ON (15s)' : 'OFF'}`);
    });

    fullBtn.addEventListener('click', () => this.toggleFullscreenVisualizer());

    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value, 10);
        const preset = this.visualizer.setPreset(idx);
        this.updateVisHUD(preset);
      });
    }

    document.getElementById('vis-canvas').addEventListener('dblclick', () => {
      this.toggleFullscreenVisualizer();
    });

    this.updateVisHUD(this.visualizer.getCurrentPreset());
  }

  populateVisPresetDropdown() {
    const select = document.getElementById('vis-preset-select');
    if (!select) return;

    select.innerHTML = '';
    const geissGroup = document.createElement('optgroup');
    geissGroup.label = '⚡ GEISS MASTERWORKS';

    const milkGroup = document.createElement('optgroup');
    milkGroup.label = '🌊 MILKDROP MASTERWORKS';

    this.visualizer.presets.forEach((preset, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = preset.name;
      if (preset.category === 'geiss') geissGroup.appendChild(opt);
      else milkGroup.appendChild(opt);
    });

    select.appendChild(geissGroup);
    select.appendChild(milkGroup);
    select.value = this.visualizer.currentPresetIndex;
  }

  updateVisHUD(preset) {
    if (!preset) return;
    const badgeEl = document.getElementById('vis-badge');
    const selectEl = document.getElementById('vis-preset-select');

    badgeEl.textContent = preset.category.toUpperCase();
    badgeEl.className = `vis-tag-badge ${preset.category}`;

    if (selectEl) {
      selectEl.value = this.visualizer.currentPresetIndex;
    }
  }

  toggleFullscreenVisualizer() {
    const visWin = document.getElementById('window-visualizer');
    const isFull = visWin.classList.toggle('visualizer-fullscreen');
    if (isFull) {
      this.showToast('Visualizer Fullscreen (Press F or ESC to exit)');
    }
  }

  // =========================================================================
  // Day Lock & Time Machine Modal
  // =========================================================================
  bindDayLockModal() {
    const openBtn = document.getElementById('btn-open-time-machine');
    const dayBadge = document.getElementById('day-badge-display');
    const modal = document.getElementById('modal-time-machine');
    const slider = document.getElementById('tm-day-slider');
    const syncBtn = document.getElementById('btn-tm-reset-real');
    const unlockAllBtn = document.getElementById('btn-tm-unlock-all');
    const closeBtns = modal.querySelectorAll('.modal-close-btn');

    const openModal = () => {
      modal.classList.add('open');
      this.renderCalendarGrid();
    };

    openBtn.addEventListener('click', openModal);
    if (dayBadge) dayBadge.addEventListener('click', openModal);

    closeBtns.forEach(b => b.addEventListener('click', () => modal.classList.remove('open')));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });

    slider.value = this.dayLock.getCurrentDay();
    slider.addEventListener('input', (e) => {
      const day = parseInt(e.target.value, 10);
      this.dayLock.setSimulatedDay(day);
      this.updateTimeMachineUI();
      this.renderPlaylist();
      this.renderCalendarGrid();
      this.updateHeaderStats();
    });

    syncBtn.addEventListener('click', () => {
      this.dayLock.setSimulatedDay(null);
      slider.value = this.dayLock.getCurrentDay();
      this.updateTimeMachineUI();
      this.renderPlaylist();
      this.renderCalendarGrid();
      this.updateHeaderStats();
      this.showToast('Synced with real calendar date!');
    });

    unlockAllBtn.addEventListener('click', () => {
      this.dayLock.setUnlockAll(!this.dayLock.unlockAllOverride);
      this.updateTimeMachineUI();
      this.renderPlaylist();
      this.renderCalendarGrid();
      this.updateHeaderStats();
      this.showToast(this.dayLock.unlockAllOverride ? '🔓 DEV MODE: All 365 Days Unlocked!' : '🔒 Standard Day Lock Restored.');
    });

    this.updateTimeMachineUI();
  }

  updateTimeMachineUI() {
    const label = document.getElementById('tm-simulated-label');
    const statsPill = document.getElementById('tm-status-pill');
    const stats = this.dayLock.getStats();

    if (stats.isUnlockAll) {
      label.textContent = `🔓 Dev Mode: All 365 Days Unlocked`;
      label.style.color = '#00ff55';
    } else if (stats.isSimulated) {
      label.textContent = `⏳ Time Machine: Day ${stats.currentDay} [${this.dayLock.dayToDateString(stats.currentDay)}]`;
      label.style.color = '#ffaa00';
    } else {
      label.textContent = `📅 Real Calendar: Day ${stats.currentDay} [${this.dayLock.dayToDateString(stats.currentDay)}]`;
      label.style.color = '#00e5ff';
    }

    statsPill.textContent = `Unlocked: ${stats.unlockedCount} / 365 (${stats.percent}%)`;
  }

  renderCalendarGrid() {
    const grid = document.getElementById('calendar-grid-365');
    if (!grid) return;
    grid.innerHTML = '';

    const currentDay = this.dayLock.getCurrentDay();

    for (let day = 1; day <= 365; day++) {
      const isUnlocked = this.dayLock.isDayUnlocked(day);
      const isToday = day === currentDay;
      const track = this.playlist.getTrackByDay(day);
      const dateStr = this.dayLock.dayToDateString(day);

      const cell = document.createElement('div');
      cell.className = 'cal-day-cell';
      if (isToday) cell.classList.add('today');
      else if (isUnlocked) cell.classList.add('unlocked');
      else cell.classList.add('locked');

      cell.title = `Day ${day} (${dateStr}): ${track ? track.title : 'Track'} [${isUnlocked ? 'Unlocked' : 'Locked'}]`;
      cell.innerHTML = `<span>${day}</span><span style="font-size:6px; opacity:0.8;">${dateStr.split(' ')[0]}</span>`;

      cell.addEventListener('click', () => {
        this.dayLock.setSimulatedDay(day);
        document.getElementById('tm-day-slider').value = day;
        this.updateTimeMachineUI();
        this.playlist.selectTrackByDay(day);
        this.renderPlaylist();
        this.renderCalendarGrid();
        this.updateHeaderStats();
        this.playCurrentTrack();
      });

      grid.appendChild(cell);
    }
  }

  // =========================================================================
  // Audio Importer Modal
  // =========================================================================
  bindImporterModal() {
    const openBtn = document.getElementById('btn-open-importer');
    const modal = document.getElementById('modal-importer');
    const dropzone = document.getElementById('dropzone-box');
    const fileInput = document.getElementById('file-input-multiple');
    const dirInput = document.getElementById('file-input-dir');
    const closeBtns = modal.querySelectorAll('.modal-close-btn');

    openBtn.addEventListener('click', () => modal.classList.add('open'));
    closeBtns.forEach(b => b.addEventListener('click', () => modal.classList.remove('open')));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });

    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', async (e) => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        this.showToast(`Importing ${files.length} custom tracks...`);
        const result = await this.playlist.importAudioFiles(files);
        this.renderPlaylist();
        this.showToast(`✅ Saved ${result.count} custom tracks in IndexedDB!`);
        modal.classList.remove('open');
      }
    });

    fileInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const result = await this.playlist.importAudioFiles(e.target.files);
        this.renderPlaylist();
        this.showToast(`✅ Imported ${result.count} custom songs!`);
        modal.classList.remove('open');
      }
    });

    dirInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const result = await this.playlist.importAudioFiles(e.target.files);
        this.renderPlaylist();
        this.showToast(`✅ Imported ${result.count} songs from folder!`);
        modal.classList.remove('open');
      }
    });
  }

  // =========================================================================
  // Playback Helpers
  // =========================================================================
  async playCurrentTrack(crossfade = false) {
    const track = this.playlist.getCurrentTrack();
    if (!track) return;

    if (!this.dayLock.isDayUnlocked(track.day)) {
      this.showToast(`🔒 Day ${track.day} "${track.title}" is locked!`, 'warn');
      return;
    }

    await this.audio.playTrack(track, crossfade);
    this.updateTrackInfoUI();
  }

  playNextTrack(crossfade = false) {
    const next = this.playlist.getNextTrack(this.isShuffle, this.isRepeat);
    if (next) {
      this.playCurrentTrack(crossfade);
    } else {
      this.audio.stop();
    }
  }

  playPrevTrack() {
    const prev = this.playlist.getPrevTrack(this.isShuffle);
    if (prev) {
      this.playCurrentTrack(false);
    }
  }

  updateTrackInfoUI() {
    const track = this.playlist.getCurrentTrack();
    if (!track) return;

    const marquee = document.getElementById('marquee-text');
    const bpmStr = track.bpm ? ` (${track.bpm} BPM · ${track.key || ''})` : '';
    const tag = track.hasCustomAudio ? '🎵 [USER AUDIO]' : '⚡ [PIM OFFICIAL STREAM]';
    marquee.textContent = `*** [DAY ${track.day.toString().padStart(3, '0')}] "${track.title}" by ${track.artist}${bpmStr} *** ${tag} *** WINAMP 365 ***`;

    document.getElementById('lcd-track-num').textContent = `TRK ${track.day.toString().padStart(3, '0')}`;
  }

  updateHeaderStats() {
    const currentDay = this.dayLock.getCurrentDay();
    const dateStr = this.dayLock.dayToDateString(currentDay);
    const countdown = this.dayLock.getTimeUntilNextUnlock();

    document.getElementById('current-day-label').textContent = `Day ${currentDay} of 365 [${dateStr}]`;
    document.getElementById('header-countdown').textContent = countdown;
  }

  // =========================================================================
  // Layout Reset
  // =========================================================================
  bindLayoutReset() {
    const resetBtn = document.getElementById('btn-reset-layout');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.windowManager.resetLayout();
        this.showToast('📐 Windows layout reset to default!');
      });
    }
  }

  // =========================================================================
  // Keyboard Shortcuts (Winamp Hotkeys)
  // =========================================================================
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const key = e.key.toLowerCase();

      if (key === 'z') {
        this.playPrevTrack();
      } else if (key === 'x') {
        this.playCurrentTrack();
      } else if (key === 'c' || key === ' ') {
        e.preventDefault();
        if (this.audio.isPlaying) this.audio.pause();
        else this.audio.resume();
      } else if (key === 'v') {
        this.audio.stop();
      } else if (key === 'b') {
        this.playNextTrack();
      } else if (key === 'd') {
        this.windowManager.toggleWindow('window-dsp');
        const b = document.getElementById('toggle-dsp-btn');
        if (b) b.classList.toggle('active');
        this.showToast('Toggled DSP Studio Window');
      } else if (key === 'n') {
        const preset = this.visualizer.nextPreset();
        this.updateVisHUD(preset);
      } else if (key === 'p') {
        const preset = this.visualizer.prevPreset();
        this.updateVisHUD(preset);
      } else if (key === 'i') {
        this.openSongInfoModal();
      } else if (key === 'l') {
        document.getElementById('modal-importer').classList.add('open');
      } else if (key === 'j') {
        document.getElementById('modal-time-machine').classList.add('open');
        this.renderCalendarGrid();
      } else if (key === 'f') {
        this.toggleFullscreenVisualizer();
      } else if (key === 's') {
        document.getElementById('btn-shuffle').click();
      } else if (key === 'r') {
        document.getElementById('btn-repeat').click();
      } else if (key === 'arrowup') {
        e.preventDefault();
        const slider = document.getElementById('vol-slider');
        slider.value = Math.min(100, parseInt(slider.value, 10) + 5);
        slider.dispatchEvent(new Event('input'));
      } else if (key === 'arrowdown') {
        e.preventDefault();
        const slider = document.getElementById('vol-slider');
        slider.value = Math.max(0, parseInt(slider.value, 10) - 5);
        slider.dispatchEvent(new Event('input'));
      } else if (key === 'arrowleft') {
        e.preventDefault();
        if (this.audio.audioElement && this.audio.audioElement.currentTime) {
          this.audio.audioElement.currentTime = Math.max(0, this.audio.audioElement.currentTime - 5);
        }
      } else if (key === 'arrowright') {
        e.preventDefault();
        if (this.audio.audioElement && this.audio.audioElement.currentTime) {
          this.audio.audioElement.currentTime += 5;
        }
      } else if (key === 'escape') {
        const visWin = document.getElementById('window-visualizer');
        if (visWin.classList.contains('visualizer-fullscreen')) {
          visWin.classList.remove('visualizer-fullscreen');
        }
        document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
      }
    });
  }

  // =========================================================================
  // Theme & Skin Switcher
  // =========================================================================
  bindSkinSelector() {
    const skinSelect = document.getElementById('skin-select');
    skinSelect.addEventListener('change', (e) => {
      const theme = e.target.value;
      document.body.className = `theme-${theme}`;
      this.showToast(`Skin switched to: ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // =========================================================================
  // Utilities & Toast Notifications
  // =========================================================================
  formatLCDTime(seconds) {
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const remS = s % 60;
    return `${m.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'retro-toast';
    if (type === 'warn') toast.style.borderColor = '#ffaa00';

    toast.innerHTML = `<span>⚡</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}

// Bootstrap on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  window.winampApp = new Winamp365App();
  window.winampApp.init();
});
