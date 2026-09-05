/**
 * ============================================================================
 * WINAMP 365 - DAY LOCK MANAGER & TIME MACHINE
 * Handles 365-day calendar mapping, daily unlock states, countdown timers,
 * and Time Machine simulation mode.
 * Default Canonical Unlock: Day 222 (August 10, 2026)
 * ============================================================================
 */

export class DayLockManager {
  constructor() {
    this.canonicalUnlockedDay = 222; // Canonical PIM release progress (Day 222)
    this.simulatedDay = 222; // Defaults to Day 222
    this.unlockAllOverride = false;

    this.loadSettings();
  }

  loadSettings() {
    try {
      const saved = localStorage.getItem('winamp365_daylock');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.unlockAllOverride = !!parsed.unlockAllOverride;
        if (parsed.simulatedDay) {
          this.simulatedDay = parseInt(parsed.simulatedDay, 10);
        }
      }
    } catch (e) {
      console.warn('DayLockManager settings load note:', e);
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('winamp365_daylock', JSON.stringify({
        unlockAllOverride: this.unlockAllOverride,
        simulatedDay: this.simulatedDay
      }));
    } catch (e) {
      console.warn('DayLockManager settings save note:', e);
    }
  }

  // Active current day (defaults to Day 222 or Time Machine simulation)
  getCurrentDay() {
    if (this.simulatedDay !== null && this.simulatedDay >= 1 && this.simulatedDay <= 365) {
      return this.simulatedDay;
    }
    return this.canonicalUnlockedDay;
  }

  // Check if a specific day is unlocked
  isDayUnlocked(dayNumber) {
    if (this.unlockAllOverride) return true;
    const current = this.getCurrentDay();
    return dayNumber <= current;
  }

  // Check if a specific day is today's active spotlight song
  isToday(dayNumber) {
    return dayNumber === this.getCurrentDay();
  }

  // Convert Day of Year (1..365) to Date string (e.g., "Jan 1", "Aug 10", "Dec 31")
  dayToDateString(dayNumber, year = 2026) {
    const date = new Date(year, 0);
    date.setDate(dayNumber);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Time remaining until the next daily song unlocks (HH:MM:SS)
  getTimeUntilNextUnlock() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const diffMs = tomorrow - now;

    if (diffMs <= 0) return '00:00:00';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }

  // Time Machine Controls
  setSimulatedDay(day) {
    if (day === null || day === undefined) {
      this.simulatedDay = this.canonicalUnlockedDay;
    } else {
      this.simulatedDay = Math.max(1, Math.min(365, parseInt(day, 10)));
    }
    this.saveSettings();
  }

  setUnlockAll(unlockAll = true) {
    this.unlockAllOverride = unlockAll;
    this.saveSettings();
  }

  getStats() {
    const current = this.getCurrentDay();
    const unlockedCount = this.unlockAllOverride ? 365 : current;
    const percent = Math.round((unlockedCount / 365) * 100);

    return {
      currentDay: current,
      dateStr: this.dayToDateString(current),
      unlockedCount,
      totalCount: 365,
      percent,
      isSimulated: this.simulatedDay !== this.canonicalUnlockedDay,
      isUnlockAll: this.unlockAllOverride
    };
  }
}
