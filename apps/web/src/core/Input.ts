/**
 * Keyboard/mouse input abstraction with remappable bindings (GDD 6.1).
 * Gameplay code asks for actions, never raw keys.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'sprint'
  | 'jump'
  | 'light'
  | 'heavy'
  | 'block'
  | 'dodge'
  | 'guardbreaker'
  | 'ability'
  | 'skill1'
  | 'skill2'
  | 'skill3'
  | 'skill4'
  | 'potion1'
  | 'potion2'
  | 'lock'
  | 'interact'
  | 'inventory'
  | 'camLeft'
  | 'camRight'
  | 'camUp'
  | 'camDown'
  | 'perf'
  | 'pause';

/** Codes are KeyboardEvent.code values, or Mouse0/Mouse1/Mouse2. */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  light: ['Mouse0', 'KeyJ'],
  heavy: ['KeyF', 'KeyK'],
  block: ['Mouse2', 'KeyL'],
  dodge: ['KeyQ', 'KeyC'],
  guardbreaker: ['KeyR'],
  ability: ['KeyG'],
  skill1: ['Digit1'],
  skill2: ['Digit2'],
  skill3: ['Digit3'],
  skill4: ['Digit4'],
  potion1: ['Digit5'],
  potion2: ['Digit6'],
  lock: ['Tab', 'Mouse1', 'KeyT'],
  interact: ['KeyE'],
  inventory: ['KeyI'],
  camLeft: ['ArrowLeft'],
  camRight: ['ArrowRight'],
  camUp: ['ArrowUp'],
  camDown: ['ArrowDown'],
  perf: ['F3', 'Backquote'],
  pause: ['Escape', 'KeyP'],
};

export const ACTION_LABELS: Partial<Record<Action, string>> = {
  light: 'LMB',
  block: 'RMB',
  heavy: 'F',
  dodge: 'Q',
  guardbreaker: 'R',
  ability: 'G',
  lock: 'Tab',
  interact: 'E',
  sprint: 'Shift',
  jump: 'Space',
};

export class Input {
  bindings: Record<Action, string[]>;
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  enabled = true;
  pointerLocked = false;
  /** True between requestPointerLock and exitPointerLock: whether a granted lock is still wanted. */
  private wantLock = false;

  constructor(private canvas: HTMLCanvasElement, bindings = DEFAULT_BINDINGS) {
    this.bindings = structuredClone(bindings);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (e.code === 'Space' && e.target === document.body)) e.preventDefault();
      if (e.code.startsWith('F') && e.code === 'F3') e.preventDefault();
      if (e.repeat) return;
      if (this.isTypingTarget(e.target)) return;
      this.down.add(e.code);
      this.pressedThisFrame.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      this.down.add(code);
      this.pressedThisFrame.add(code);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      // The browser grants a lock asynchronously. If a menu opened (exitPointerLock) before the
      // grant arrived, the late lock would capture the mouse over that menu: every click would
      // go to the game canvas instead. Release it.
      if (this.pointerLocked && !this.wantLock) document.exitPointerLock();
    });
  }

  private isTypingTarget(t: EventTarget | null): boolean {
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  }

  requestPointerLock(): void {
    this.wantLock = true;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* pointer lock unavailable (automation / iframe); arrow keys still rotate the camera */
    }
  }

  /** Releases the mouse, and cancels a lock request the browser hasn't granted yet. */
  exitPointerLock(): void {
    this.wantLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  held(a: Action): boolean {
    if (!this.enabled) return false;
    return this.bindings[a].some((c) => this.down.has(c));
  }

  pressed(a: Action): boolean {
    if (!this.enabled && a !== 'pause' && a !== 'inventory' && a !== 'perf') return false;
    return this.bindings[a].some((c) => this.pressedThisFrame.has(c));
  }

  /** Swallow a press this frame (e.g. the click that captures the mouse). */
  consume(code: string): void {
    this.pressedThisFrame.delete(code);
    this.down.delete(code);
  }

  /** Simulate input (used by automated browser tests). */
  simulate(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressedThisFrame.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  }

  /** Call once at the end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  clear(): void {
    this.down.clear();
    this.pressedThisFrame.clear();
  }
}
