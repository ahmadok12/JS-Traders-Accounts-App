/**
 * Phone buzzer for warehouse staff.
 *
 * Browsers only allow sound after the user has tapped the page once, so the staff app asks
 * the picker to tap "Start duty" — that tap unlocks audio, asks for notification permission
 * and keeps the screen awake. After that an urgent task plays a loud, repeating two-tone siren
 * at full volume and vibrates until the picker taps "Accept".
 *
 * When the app is in the background (another app open / screen off but the app still running)
 * a system notification with vibration is also shown through the service worker.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sirenTimer: number | null = null;
let vibTimer: number | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;

type AudioCtor = typeof AudioContext;
function audioCtor(): AudioCtor | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Must be called from a tap. Returns true when sound is ready. */
export async function unlockAlarm(): Promise<boolean> {
  try {
    const C = audioCtor();
    if (!C) return false;
    if (!ctx) {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 1;
      // compressor lets us push the level hard without ugly clipping
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -6;
      comp.ratio.value = 12;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state !== "running") await ctx.resume();
    // play a very short click so iOS/Android consider audio "started by the user"
    beep(1200, 0.05, 0.2);
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export function alarmReady() {
  return !!ctx && ctx.state === "running";
}

function beep(freq: number, seconds: number, level = 1, type: OscillatorType = "square") {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.01);
  g.gain.setValueAtTime(level, t + seconds - 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

/** Loud repeating siren + vibration until stopAlarm(). */
export function startAlarm() {
  if (sirenTimer != null) return;
  if (ctx && ctx.state !== "running") void ctx.resume();
  const cycle = () => {
    // hi-lo siren: 4 quick alternating tones
    if (!ctx) return;
    const steps: [number, number][] = [[1400, 0], [950, 0.18], [1400, 0.36], [950, 0.54]];
    for (const [f, at] of steps) window.setTimeout(() => beep(f, 0.17, 1), at * 1000);
  };
  cycle();
  sirenTimer = window.setInterval(cycle, 1100);
  if ("vibrate" in navigator) {
    navigator.vibrate([600, 200, 600, 200, 600]);
    vibTimer = window.setInterval(() => navigator.vibrate([600, 200, 600, 200, 600]), 2500);
  }
}

export function stopAlarm() {
  if (sirenTimer != null) window.clearInterval(sirenTimer);
  if (vibTimer != null) window.clearInterval(vibTimer);
  sirenTimer = null;
  vibTimer = null;
  if ("vibrate" in navigator) navigator.vibrate(0);
}

/** Short double chime for managers (shortage / task finished). */
export function chime() {
  if (!ctx) return;
  beep(880, 0.15, 0.8, "sine");
  window.setTimeout(() => beep(1320, 0.25, 0.8, "sine"), 170);
}

/** Office screens: unlock audio on the first click anywhere. */
export function unlockOnFirstGesture() {
  const go = () => {
    void unlockAlarm();
    window.removeEventListener("pointerdown", go);
    window.removeEventListener("keydown", go);
  };
  window.addEventListener("pointerdown", go);
  window.addEventListener("keydown", go);
}

export async function keepScreenAwake() {
  try {
    const nav = navigator as unknown as { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    if (nav.wakeLock && !wakeLock) {
      wakeLock = await nav.wakeLock.request("screen");
      (wakeLock as unknown as { addEventListener?: (e: string, f: () => void) => void }).addEventListener?.("release", () => { wakeLock = null; });
    }
  } catch {
    /* not supported / not allowed */
  }
}

export async function askNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

/** System notification (shown even when the app is in the background but still running). */
export async function systemNotify(title: string, body: string, opts: { tag?: string; urgent?: boolean; url?: string } = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean; requireInteraction?: boolean } = {
    body,
    tag: opts.tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: opts.url ?? "/m" },
    requireInteraction: !!opts.urgent,
    renotify: true,
    vibrate: opts.urgent ? [800, 200, 800, 200, 800, 200, 800] : [200],
  };
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* ignore */
  }
}
