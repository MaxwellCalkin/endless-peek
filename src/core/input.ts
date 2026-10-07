import type { Action } from '../config/settings';

/**
 * Keyboard + mouse state with pointer lock.
 *
 * Mouse look uses raw counts: with `requestPointerLock({ unadjustedMovement: true })` Chrome,
 * Edge (Windows/macOS) and Firefox 152+ report movementX/Y straight from the OS raw-input
 * stream, unaffected by pointer speed, acceleration or display scaling.
 */
export class Input {
  private down = new Set<string>();
  /** Presses waiting to be consumed by a simulation tick. */
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  rawActive = false;
  /** Learned on the first attempt so later locks don't waste the click's user activation. */
  private rawSupported: boolean | null = null;
  /** Firefox reports non-raw pointer-lock movement in CSS pixels; scale back to device pixels. */
  private fallbackScale = 1;
  onUnlock: (() => void) | null = null;
  onLock: (() => void) | null = null;
  onKey: ((code: string) => void) | null = null;
  private target: HTMLElement;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', (e) => {
      // While playing, keep keys away from the browser (Tab focus, Space scroll, Ctrl shortcuts).
      if (this.locked && e.code !== 'F11' && e.code !== 'F12') e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
        this.onKey?.(e.code);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressed.add(code);
      e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      this.down.delete(`Mouse${e.button}`);
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.pressed.add(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
      },
      { passive: true },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX * this.fallbackScale;
      this.dy += e.movementY * this.fallbackScale;
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.target;
      if (!this.locked) {
        this.down.clear();
        this.dx = 0;
        this.dy = 0;
        if (was) this.onUnlock?.();
      } else if (!was) {
        this.onLock?.();
      }
    });
  }

  /** Request pointer lock (must run inside a user gesture). Resolves with whether raw input is on. */
  async lock(raw: boolean): Promise<boolean> {
    const el = this.target as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    const firefox = /firefox/i.test(navigator.userAgent);
    if (this.locked) return this.rawActive;
    if (raw && this.rawSupported !== false) {
      try {
        await el.requestPointerLock({ unadjustedMovement: true });
        this.rawActive = true;
        this.rawSupported = true;
        this.fallbackScale = 1;
        return true;
      } catch (e) {
        // Not supported (e.g. Linux, older browsers): fall back to the OS cursor stream.
        if (e instanceof DOMException && e.name === 'NotSupportedError') this.rawSupported = false;
      }
    }
    this.rawActive = false;
    this.fallbackScale = firefox ? window.devicePixelRatio || 1 : 1;
    try {
      await el.requestPointerLock();
    } catch {
      // The browser refused (e.g. too soon after Esc); the caller shows "click to resume".
    }
    return false;
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Mouse counts since the last call. */
  consumeMouse(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per press (latched until a tick consumes it). */
  consumePress(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  peekPress(code: string): boolean {
    return this.pressed.has(code);
  }

  clearPresses(): void {
    this.pressed.clear();
  }

  /** Synthetic key state for the debug autopilot: behaves like a real key down / up. */
  inject(code: string, down: boolean): void {
    if (down) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  }

  held(binds: Record<Action, string>, a: Action): boolean {
    return this.isDown(binds[a]);
  }

  press(binds: Record<Action, string>, a: Action): boolean {
    return this.consumePress(binds[a]);
  }
}
