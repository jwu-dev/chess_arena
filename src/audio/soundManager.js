// Customizable Sound Manager: Built-in Web Audio synth packs + Persistent Custom Uploads per event

export const SOUND_EVENTS = [
  { id: 'move', label: 'Move Piece', desc: 'Standard piece placement sound' },
  { id: 'capture', label: 'Capture (Taking)', desc: 'When a piece captures another piece' },
  { id: 'check', label: 'Check', desc: 'When a king is placed in check' },
  { id: 'castle', label: 'Castle', desc: 'Kingside or queenside castling' },
  { id: 'promote', label: 'Promotion', desc: 'Pawn reaching the 8th/1st rank' },
  { id: 'gameStart', label: 'Game Start', desc: 'When a new match begins' },
  { id: 'gameEnd', label: 'Game Over', desc: 'Checkmate, draw, or resignation' },
  { id: 'illegal', label: 'Illegal Move', desc: 'Subtle feedback on invalid move' }
];

export const SOUND_PACKS = [
  { id: 'classic', label: 'Classic Wood (Chess.com style)' },
  { id: 'marble', label: 'Crisp Marble' },
  { id: 'arcade', label: 'Retro Arcade' },
  { id: 'soft', label: 'Soft Felt' },
  { id: 'silent', label: 'Silent (Built-in muted)' }
];

const DB_NAME = 'ChessArenaAudioDB';
const STORE_NAME = 'customSounds';
const SETTINGS_KEY = 'chessArena.soundSettings.v1';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SoundManager {
  constructor() {
    this.ctx = null;
    this.customBuffers = new Map(); // eventId -> { buffer: AudioBuffer, name: string, raw: ArrayBuffer }
    this.customMeta = {}; // eventId -> { name }
    this.settings = this.loadSettings();
    this.readyPromise = this.loadCustomSoundsFromDB();
  }

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return {
        pack: saved.pack || 'classic',
        masterVolume: saved.masterVolume ?? 0.85,
        muted: Boolean(saved.muted),
        pitch: saved.pitch ?? 1.0,
        perEventVolume: saved.perEventVolume || {}
      };
    } catch {
      return {
        pack: 'classic',
        masterVolume: 0.85,
        muted: false,
        pitch: 1.0,
        perEventVolume: {}
      };
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage quota errors
    }
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  async loadCustomSoundsFromDB() {
    try {
      const db = await openDB();
      if (!db) return;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      await Promise.all(
        SOUND_EVENTS.map(
          (ev) =>
            new Promise((resolve) => {
              const req = store.get(ev.id);
              req.onsuccess = () => {
                if (req.result && req.result.raw) {
                  this.customBuffers.set(ev.id, {
                    name: req.result.name,
                    raw: req.result.raw,
                    buffer: null
                  });
                  this.customMeta[ev.id] = { name: req.result.name };
                }
                resolve();
              };
              req.onerror = () => resolve();
            })
        )
      );
    } catch {
      // IndexedDB unavailable in private mode; continue with synth fallback
    }
  }

  async uploadCustomSound(eventId, file) {
    const raw = await file.arrayBuffer();
    const ctx = this.ensureContext();
    let decoded = null;
    if (ctx) {
      // Clone buffer because decodeAudioData detaches the passed ArrayBuffer
      decoded = await ctx.decodeAudioData(raw.slice(0));
    }

    this.customBuffers.set(eventId, {
      name: file.name,
      raw,
      buffer: decoded
    });
    this.customMeta[eventId] = { name: file.name };

    try {
      const db = await openDB();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put({ name: file.name, raw }, eventId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch {
      // Non-fatal if IndexedDB write fails
    }
    return { name: file.name };
  }

  async clearCustomSound(eventId) {
    this.customBuffers.delete(eventId);
    delete this.customMeta[eventId];
    try {
      const db = await openDB();
      if (db) {
        await new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(eventId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      }
    } catch {
      // ignore
    }
  }

  async resetAllCustomSounds() {
    for (const ev of SOUND_EVENTS) {
      await this.clearCustomSound(ev.id);
    }
  }

  setPack(packId) {
    this.settings.pack = packId;
    this.saveSettings();
  }

  setMasterVolume(vol) {
    this.settings.masterVolume = Math.max(0, Math.min(1, Number(vol)));
    this.saveSettings();
  }

  setPitch(pitch) {
    this.settings.pitch = Math.max(0.5, Math.min(1.8, Number(pitch)));
    this.saveSettings();
  }

  setMuted(muted) {
    this.settings.muted = Boolean(muted);
    this.saveSettings();
  }

  setEventVolume(eventId, vol) {
    this.settings.perEventVolume[eventId] = Math.max(0, Math.min(1, Number(vol)));
    this.saveSettings();
  }

  getEventVolume(eventId) {
    const evVol = this.settings.perEventVolume[eventId] ?? 1.0;
    return this.settings.masterVolume * evVol;
  }

  async play(eventId) {
    if (this.settings.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const gain = this.getEventVolume(eventId);
    if (gain <= 0.001) return;

    // 1. Play user's custom uploaded audio if present for this event
    const custom = this.customBuffers.get(eventId);
    if (custom) {
      try {
        if (!custom.buffer && custom.raw) {
          custom.buffer = await ctx.decodeAudioData(custom.raw.slice(0));
        }
        if (custom.buffer) {
          const src = ctx.createBufferSource();
          src.buffer = custom.buffer;
          src.playbackRate.value = this.settings.pitch;
          const gainNode = ctx.createGain();
          gainNode.gain.value = gain;
          src.connect(gainNode);
          gainNode.connect(ctx.destination);
          src.start();
          return;
        }
      } catch {
        // Fallback to synth pack if decode fails
      }
    }

    // 2. Built-in procedural Web Audio synth sound pack
    if (this.settings.pack === 'silent') return;
    this.playSynth(ctx, eventId, this.settings.pack, gain, this.settings.pitch);
  }

  createNoiseBurst(ctx, durationSec, filterFreq, filterQ, volume, startTime = ctx.currentTime) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.25));
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(filterQ, startTime);

    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + durationSec);

    src.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    src.start(startTime);
  }

  playTone(ctx, { type = 'sine', freqStart, freqEnd, duration, volume, startTime = ctx.currentTime }) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, startTime);
    if (freqEnd && freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);
    }
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.linearRampToValueAtTime(volume, startTime + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  playSynth(ctx, eventId, pack, vol, pitch) {
    const now = ctx.currentTime;

    if (pack === 'arcade') {
      switch (eventId) {
        case 'move':
          this.playTone(ctx, { type: 'square', freqStart: 320 * pitch, freqEnd: 220 * pitch, duration: 0.06, volume: vol * 0.22 });
          break;
        case 'capture':
          this.playTone(ctx, { type: 'sawtooth', freqStart: 520 * pitch, freqEnd: 140 * pitch, duration: 0.13, volume: vol * 0.28 });
          break;
        case 'check':
          this.playTone(ctx, { type: 'square', freqStart: 660 * pitch, freqEnd: 880 * pitch, duration: 0.14, volume: vol * 0.26 });
          break;
        case 'castle':
          this.playTone(ctx, { type: 'square', freqStart: 300 * pitch, freqEnd: 300 * pitch, duration: 0.05, volume: vol * 0.22, startTime: now });
          this.playTone(ctx, { type: 'square', freqStart: 420 * pitch, freqEnd: 420 * pitch, duration: 0.07, volume: vol * 0.22, startTime: now + 0.07 });
          break;
        case 'promote':
          [440, 554, 659, 880].forEach((f, idx) => {
            this.playTone(ctx, { type: 'square', freqStart: f * pitch, duration: 0.09, volume: vol * 0.2, startTime: now + idx * 0.055 });
          });
          break;
        case 'gameStart':
          this.playTone(ctx, { type: 'triangle', freqStart: 392 * pitch, duration: 0.09, volume: vol * 0.25, startTime: now });
          this.playTone(ctx, { type: 'triangle', freqStart: 523 * pitch, duration: 0.14, volume: vol * 0.25, startTime: now + 0.09 });
          break;
        case 'gameEnd':
          [523, 659, 784].forEach((f, idx) => {
            this.playTone(ctx, { type: 'triangle', freqStart: f * pitch, duration: 0.22, volume: vol * 0.25, startTime: now + idx * 0.09 });
          });
          break;
        default:
          this.playTone(ctx, { type: 'sawtooth', freqStart: 150 * pitch, freqEnd: 110 * pitch, duration: 0.09, volume: vol * 0.2 });
      }
      return;
    }

    // Wood / Marble / Soft tactile acoustics
    const freqScale = pack === 'marble' ? 1.55 : pack === 'soft' ? 0.72 : 1.0;
    const sharpQ = pack === 'marble' ? 2.6 : pack === 'soft' ? 0.8 : 1.4;
    const p = pitch * freqScale;

    switch (eventId) {
      case 'move':
        // Warm tactile wooden "thock"
        this.playTone(ctx, { type: 'triangle', freqStart: 210 * p, freqEnd: 85 * p, duration: 0.065, volume: vol * 0.45 });
        this.createNoiseBurst(ctx, 0.04, 1100 * p, sharpQ, vol * 0.32);
        break;
      case 'capture':
        // Crisp two-stage piece collision clack
        this.createNoiseBurst(ctx, 0.07, 1650 * p, sharpQ, vol * 0.55, now);
        this.playTone(ctx, { type: 'triangle', freqStart: 290 * p, freqEnd: 75 * p, duration: 0.09, volume: vol * 0.55, startTime: now });
        this.createNoiseBurst(ctx, 0.045, 950 * p, 1.2, vol * 0.35, now + 0.025);
        break;
      case 'check':
        // Wood hit + sharp alert overtone
        this.playTone(ctx, { type: 'triangle', freqStart: 230 * p, freqEnd: 90 * p, duration: 0.07, volume: vol * 0.4 });
        this.playTone(ctx, { type: 'sine', freqStart: 690 * pitch, freqEnd: 520 * pitch, duration: 0.19, volume: vol * 0.32, startTime: now + 0.01 });
        break;
      case 'castle':
        // Two-step king + rook placement
        this.playTone(ctx, { type: 'triangle', freqStart: 205 * p, freqEnd: 85 * p, duration: 0.06, volume: vol * 0.4, startTime: now });
        this.createNoiseBurst(ctx, 0.035, 1100 * p, sharpQ, vol * 0.28, now);
        this.playTone(ctx, { type: 'triangle', freqStart: 245 * p, freqEnd: 95 * p, duration: 0.07, volume: vol * 0.42, startTime: now + 0.095 });
        this.createNoiseBurst(ctx, 0.04, 1250 * p, sharpQ, vol * 0.3, now + 0.095);
        break;
      case 'promote':
        this.playTone(ctx, { type: 'triangle', freqStart: 440 * pitch, duration: 0.11, volume: vol * 0.28, startTime: now });
        this.playTone(ctx, { type: 'triangle', freqStart: 554 * pitch, duration: 0.11, volume: vol * 0.28, startTime: now + 0.07 });
        this.playTone(ctx, { type: 'sine', freqStart: 880 * pitch, duration: 0.24, volume: vol * 0.32, startTime: now + 0.14 });
        break;
      case 'gameStart':
        this.playTone(ctx, { type: 'sine', freqStart: 440 * pitch, duration: 0.1, volume: vol * 0.22, startTime: now });
        this.playTone(ctx, { type: 'sine', freqStart: 587 * pitch, duration: 0.16, volume: vol * 0.24, startTime: now + 0.08 });
        break;
      case 'gameEnd':
        this.playTone(ctx, { type: 'sine', freqStart: 523 * pitch, duration: 0.16, volume: vol * 0.25, startTime: now });
        this.playTone(ctx, { type: 'sine', freqStart: 659 * pitch, duration: 0.18, volume: vol * 0.25, startTime: now + 0.1 });
        this.playTone(ctx, { type: 'sine', freqStart: 784 * pitch, duration: 0.32, volume: vol * 0.28, startTime: now + 0.2 });
        break;
      default:
        this.playTone(ctx, { type: 'sine', freqStart: 165 * pitch, freqEnd: 120 * pitch, duration: 0.09, volume: vol * 0.22 });
    }
  }
}
