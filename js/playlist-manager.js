/**
 * ============================================================================
 * WINAMP 365 - PLAYLIST MANAGER & PIM 365-SONG DATABASE INTEGRATION
 * Seeds all 365 tracks directly from the official PIM ecosystem catalog,
 * supports high-fidelity audio streaming, ID3 metadata parsing, and IndexedDB caching.
 * ============================================================================
 */

export class PlaylistManager {
  constructor(dayLockManager) {
    this.dayLock = dayLockManager;
    this.tracks = []; // Array of 365 track objects
    this.currentIndex = 0;
    this.activeFilter = 'all'; // 'all', 'unlocked', 'today', 'locked'
    this.searchQuery = '';
    this.db = null;
    this.isPimSeeded = false;

    this.initDefaultTracks();
  }

  // 1. Initialize 365 Tracks (Initializes skeleton, then loads PIM database)
  initDefaultTracks() {
    this.tracks = [];
    for (let day = 1; day <= 365; day++) {
      const dateStr = this.dayLock.dayToDateString(day);
      const padDay = day.toString().padStart(3, '0');

      this.tracks.push({
        id: `day-${padDay}`,
        day: day,
        title: `Day ${padDay} - Track Loading...`,
        artist: `TH3SCR1B3`,
        album: `The 365 Days of PIM (2026)`,
        genre: ['Alternative'],
        mood: 'neutral',
        moodTags: [],
        description: '',
        dateStr: dateStr,
        bpm: 120,
        key: 'C major',
        difficultyLevel: 5,
        duration: 210,
        durationStr: this.formatTime(210),
        audioSrc: null, // PIM CDN audio URL
        audioBlobUrl: null, // Local user audio override
        coverArt: null,
        hasCustomAudio: false,
        isPimOfficial: true,
        bitrate: 320,
        sampleRate: 44.1
      });
    }
  }

  // 2. Fetch and Seed from PIM Database
  async seedFromPimDatabase() {
    try {
      const res = await fetch('/data/pim_song_catalog.json');
      if (!res.ok) throw new Error('Could not load pim_song_catalog.json');
      const pimSongs = await res.json();

      if (Array.isArray(pimSongs) && pimSongs.length > 0) {
        pimSongs.forEach(song => {
          const track = this.tracks.find(t => t.day === song.day);
          if (track) {
            track.id = song.id || track.id;
            track.title = song.title || track.title;
            track.artist = song.artist || 'TH3SCR1B3';
            track.audioSrc = song.audioUrl || null;
            track.coverArt = song.coverArt || null;
            track.bpm = song.bpm || 120;
            track.key = song.key || 'C major';
            track.genre = Array.isArray(song.genre) ? song.genre : [song.genre || 'Electronic'];
            track.mood = song.mood || 'neutral';
            track.moodTags = song.moodTags || [];
            track.description = song.description || '';
            track.difficultyLevel = song.difficultyLevel || 5;
            if (song.duration) {
              track.duration = song.duration;
              track.durationStr = this.formatTime(song.duration);
            }
            track.isPimOfficial = true;
          }
        });
        this.isPimSeeded = true;
        console.log(`✅ Winamp 365 successfully seeded with ${pimSongs.length} PIM tracks!`);
        return true;
      }
    } catch (err) {
      console.warn('PIM catalog seed note (falling back to API):', err);
      try {
        const res2 = await fetch('/api/pim/songs');
        const data = await res2.json();
        if (data.success && Array.isArray(data.songs)) {
          data.songs.forEach(song => {
            const track = this.tracks.find(t => t.day === song.day);
            if (track) {
              track.title = song.title;
              track.artist = song.artist;
              track.audioSrc = song.audioUrl;
              track.coverArt = song.coverArt;
              track.bpm = song.bpm;
              track.key = song.key;
              track.genre = song.genre;
              track.duration = song.duration;
              track.durationStr = this.formatTime(song.duration);
              track.isPimOfficial = true;
            }
          });
          this.isPimSeeded = true;
          return true;
        }
      } catch (e2) {
        console.warn('PIM API fallback note:', e2);
      }
    }
    return false;
  }

  // 3. High-Performance IndexedDB Storage for User Audio Files
  async initStorage() {
    return new Promise((resolve) => {
      const request = indexedDB.open('Winamp365AudioDB', 2);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('audio_tracks')) {
          db.createObjectStore('audio_tracks', { keyPath: 'day' });
        }
      };

      request.onsuccess = async (e) => {
        this.db = e.target.result;
        await this.seedFromPimDatabase();
        await this.loadStoredAudioFiles();
        resolve(true);
      };

      request.onerror = async (err) => {
        console.warn('IndexedDB initialization note:', err);
        await this.seedFromPimDatabase();
        resolve(false);
      };
    });
  }

  async loadStoredAudioFiles() {
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction(['audio_tracks'], 'readonly');
        const store = transaction.objectStore('audio_tracks');
        const req = store.getAll();

        req.onsuccess = () => {
          const storedItems = req.result || [];
          storedItems.forEach(item => {
            const track = this.tracks.find(t => t.day === item.day);
            if (track && item.blob) {
              if (track.audioBlobUrl) URL.revokeObjectURL(track.audioBlobUrl);
              track.audioBlobUrl = URL.createObjectURL(item.blob);
              track.hasCustomAudio = true;
              if (item.title) track.title = item.title;
              if (item.artist) track.artist = item.artist;
              if (item.duration) {
                track.duration = item.duration;
                track.durationStr = this.formatTime(item.duration);
              }
            }
          });
          resolve(true);
        };

        req.onerror = () => resolve(false);
      } catch (err) {
        console.warn('IndexedDB load error:', err);
        resolve(false);
      }
    });
  }

  async saveAudioFileToDay(dayNumber, file, metadata = {}) {
    const track = this.tracks.find(t => t.day === dayNumber);
    if (!track) return false;

    if (track.audioBlobUrl) URL.revokeObjectURL(track.audioBlobUrl);
    track.audioBlobUrl = URL.createObjectURL(file);
    track.hasCustomAudio = true;
    track.title = metadata.title || file.name.replace(/\.[^/.]+$/, '');
    track.artist = metadata.artist || 'Local Import';

    if (this.db) {
      try {
        const transaction = this.db.transaction(['audio_tracks'], 'readwrite');
        const store = transaction.objectStore('audio_tracks');
        store.put({
          day: dayNumber,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          blob: file,
          fileName: file.name,
          updatedAt: Date.now()
        });
      } catch (err) {
        console.warn('IndexedDB save note:', err);
      }
    }
    return true;
  }

  // 4. Batch Audio Importer
  async importAudioFiles(fileList, startAtDay = null) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|webm)$/i.test(f.name));
    if (files.length === 0) return { count: 0 };

    let importedCount = 0;
    let nextSequentialDay = startAtDay || 1;

    for (const file of files) {
      let targetDay = null;
      const dayMatch = file.name.match(/(?:day|track)?[_\s-]*0*([1-9][0-9]{0,2})/i);

      if (dayMatch && dayMatch[1]) {
        const num = parseInt(dayMatch[1], 10);
        if (num >= 1 && num <= 365) {
          targetDay = num;
        }
      }

      if (!targetDay) {
        targetDay = nextSequentialDay;
        nextSequentialDay = (nextSequentialDay % 365) + 1;
      }

      let title = file.name.replace(/\.[^/.]+$/, '');
      title = title.replace(/^[0-9]+[_\s-]+/, '');

      await this.saveAudioFileToDay(targetDay, file, {
        title: `Day ${targetDay.toString().padStart(3, '0')} - ${title}`,
        artist: 'User Library'
      });

      importedCount++;
    }

    return { count: importedCount };
  }

  // Clear custom audio and revert to official PIM audio
  async clearAudioStorage() {
    if (this.db) {
      const transaction = this.db.transaction(['audio_tracks'], 'readwrite');
      transaction.objectStore('audio_tracks').clear();
    }
    this.tracks.forEach(track => {
      if (track.audioBlobUrl) {
        URL.revokeObjectURL(track.audioBlobUrl);
        track.audioBlobUrl = null;
      }
      track.hasCustomAudio = false;
    });
    await this.seedFromPimDatabase();
  }

  // 5. Playlist Querying & Filtering
  getFilteredTracks() {
    let result = this.tracks;

    if (this.activeFilter === 'unlocked') {
      result = result.filter(t => this.dayLock.isDayUnlocked(t.day));
    } else if (this.activeFilter === 'today') {
      result = result.filter(t => this.dayLock.isToday(t.day));
    } else if (this.activeFilter === 'locked') {
      result = result.filter(t => !this.dayLock.isDayUnlocked(t.day));
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase().trim();
      result = result.filter(t => 
        t.day.toString().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.dateStr.toLowerCase().includes(q) ||
        (t.bpm && t.bpm.toString().includes(q)) ||
        (t.key && t.key.toLowerCase().includes(q)) ||
        (Array.isArray(t.genre) && t.genre.some(g => g.toLowerCase().includes(q))) ||
        (Array.isArray(t.moodTags) && t.moodTags.some(m => m.toLowerCase().includes(q)))
      );
    }

    return result;
  }

  getCurrentTrack() {
    return this.tracks[this.currentIndex] || this.tracks[0];
  }

  getTrackByDay(dayNumber) {
    return this.tracks.find(t => t.day === dayNumber);
  }

  selectTrackByIndex(index) {
    if (index >= 0 && index < this.tracks.length) {
      this.currentIndex = index;
      return this.tracks[this.currentIndex];
    }
    return null;
  }

  selectTrackByDay(dayNumber) {
    const idx = this.tracks.findIndex(t => t.day === dayNumber);
    if (idx !== -1) {
      this.currentIndex = idx;
      return this.tracks[idx];
    }
    return null;
  }

  getNextTrack(shuffle = false, repeat = false) {
    if (shuffle) {
      const unlocked = this.tracks.filter(t => this.dayLock.isDayUnlocked(t.day));
      if (unlocked.length === 0) return this.getCurrentTrack();
      const randomTrack = unlocked[Math.floor(Math.random() * unlocked.length)];
      this.currentIndex = this.tracks.indexOf(randomTrack);
      return randomTrack;
    }

    let nextIdx = this.currentIndex + 1;
    if (nextIdx >= this.tracks.length) {
      if (repeat) {
        nextIdx = 0;
      } else {
        return null;
      }
    }

    while (nextIdx < this.tracks.length && !this.dayLock.isDayUnlocked(this.tracks[nextIdx].day)) {
      nextIdx++;
    }

    if (nextIdx >= this.tracks.length) {
      if (repeat) {
        nextIdx = 0;
        while (nextIdx < this.tracks.length && !this.dayLock.isDayUnlocked(this.tracks[nextIdx].day)) {
          nextIdx++;
        }
      } else {
        return null;
      }
    }

    this.currentIndex = nextIdx;
    return this.tracks[this.currentIndex];
  }

  getPrevTrack(shuffle = false) {
    if (shuffle) return this.getNextTrack(true, false);

    let prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) prevIdx = this.tracks.length - 1;

    while (prevIdx >= 0 && !this.dayLock.isDayUnlocked(this.tracks[prevIdx].day)) {
      prevIdx--;
    }

    if (prevIdx < 0) prevIdx = 0;
    this.currentIndex = prevIdx;
    return this.tracks[this.currentIndex];
  }

  formatTime(seconds) {
    const s = Math.floor(seconds || 0);
    const m = Math.floor(s / 60);
    const remS = s % 60;
    return `${m}:${remS.toString().padStart(2, '0')}`;
  }
}
