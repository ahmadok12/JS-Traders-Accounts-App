/**
 * JS Traders ERP - High-Audibility Industrial Alert Sound & Haptics Engine
 * Generates an instant, penetrating alarm chime using the standard Web Audio API.
 * Requires 0 external audio files, operates 100% offline, and triggers mobile haptic vibration.
 */

class SoundAlertManager {
  constructor() {
    this.audioCtx = null;
    this.isMuted = false;
    this.isUnlocked = false;
  }

  init() {
    if (!this.audioCtx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
  }

  unlock() {
    this.init();
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      try {
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
      } catch (e) {}
    }
    this.isUnlocked = true;
  }

  /**
   * Plays a loud, distinctive multi-tone industrial alert sound
   * Sequence: High-penetration dual-tone pulses [880Hz, 1320Hz, 880Hz, 1760Hz]
   */
  playLoudAlert() {
    this.unlock();
    if (this.isMuted) return;

    // Trigger mobile vibration if device hardware permits
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([350, 150, 350, 150, 600]);
      } catch (e) {}
    }

    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;

      // Two-burst alarm sequence (repeated for maximum attention)
      const burst1 = [
        { freq: 880, start: 0, duration: 0.12 },
        { freq: 1320, start: 0.15, duration: 0.15 },
        { freq: 880, start: 0.33, duration: 0.12 },
        { freq: 1760, start: 0.48, duration: 0.30 }
      ];

      const burst2 = [
        { freq: 880, start: 0.90, duration: 0.12 },
        { freq: 1320, start: 1.05, duration: 0.15 },
        { freq: 880, start: 1.23, duration: 0.12 },
        { freq: 1760, start: 1.38, duration: 0.40 }
      ];

      const allTones = [...burst1, ...burst2];

      allTones.forEach(t => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        // Use square/sawtooth for penetrating acoustic harmonics in noisy warehouses
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(t.freq, now + t.start);

        // High gain volume envelope
        gain.gain.setValueAtTime(0.001, now + t.start);
        gain.gain.exponentialRampToValueAtTime(0.85, now + t.start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t.start + t.duration);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + t.start);
        osc.stop(now + t.start + t.duration + 0.05);
      });
    } catch (err) {
      console.warn('Web Audio playback error:', err);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }
}

export const soundAlert = new SoundAlertManager();
