import { DIFFICULTIES, type Difficulty } from '../bots/bot';
import {
  ACTION_LABELS,
  type Action,
  type BestRun,
  DEFAULT_BINDS,
  DEFAULT_SETTINGS,
  type Settings,
  bindLabel,
} from '../config/settings';
import { PRIMARY_IDS, SECONDARY_IDS, WEAPONS } from '../config/weapons';
import { OTHER_GAMES, cmPer360, convertFrom, edpi } from '../core/view';
import { type RunStats, TAG_LABELS, TAG_PHRASES } from '../game/stats';
import { CrosshairView } from './crosshair';
import {
  CROSSHAIR_COLORS,
  CrosshairCodeError,
  parseCrosshairCode,
  serializeCrosshairCode,
} from './crosshairCode';
import { fmtMs, fmtTime } from './hud';

type Tab = 'gameplay' | 'mouse' | 'crosshair' | 'controls' | 'video';

const CROSSHAIR_PRESETS: [string, string][] = [
  ['VALORANT default', '0'],
  ['Cyan cross (no outline)', '0;P;c;5;h;0;f;0;0l;4;0o;2;0a;1;0f;0;1b;0'],
  ['Small green dot', '0;P;c;1;h;0;d;1;z;3;f;0;0b;0;1b;0'],
  ['White plus, outlined', '0;P;o;1;f;0;0t;1;0l;3;0o;2;0a;1;0f;0;1b;0'],
  ['Yellow tight cross', '0;P;c;4;o;1;f;0;0t;1;0l;2;0o;2;0a;1;0f;0;1b;0'],
  ['Pink dot + lines', '0;P;c;6;h;0;d;1;z;2;f;0;0l;3;0o;3;0a;1;0f;0;1b;0'],
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

export interface MenuCallbacks {
  onPlay: () => void;
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettings: (s: Settings, keys: (keyof Settings)[]) => void;
}

export class Menus {
  readonly root: HTMLElement;
  private screen: HTMLElement;
  private tab: Tab = 'gameplay';
  private capturing: Action | null = null;
  private mode: 'main' | 'pause' | 'results' = 'main';
  private results: { stats: RunStats; now: number; best: BestRun | undefined; newBest: boolean; survival: boolean } | null = null;
  rawActive: boolean | null = null;

  constructor(
    parent: HTMLElement,
    private settings: Settings,
    private cb: MenuCallbacks,
    private best: () => Partial<Record<Difficulty, BestRun>>,
  ) {
    this.root = h('div', { class: 'menu' });
    this.screen = h('div', { class: 'menu-screen' });
    this.root.append(this.screen);
    parent.append(this.root);
    window.addEventListener('keydown', (e) => this.captureKey(e), true);
    window.addEventListener('mousedown', (e) => this.captureMouse(e), true);
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  showMain(): void {
    this.mode = 'main';
    this.render();
  }

  showPause(): void {
    this.mode = 'pause';
    this.render();
  }

  showResults(stats: RunStats, now: number, best: BestRun | undefined, newBest: boolean, survival: boolean): void {
    this.mode = 'results';
    this.results = { stats, now, best, newBest, survival };
    this.render();
  }

  private change(keys: (keyof Settings)[]): void {
    this.cb.onSettings(this.settings, keys);
  }

  private render(): void {
    this.root.style.display = '';
    this.screen.innerHTML = '';
    const left = h('div', { class: 'menu-left' });
    const right = h('div', { class: 'menu-right' });
    this.screen.append(left, right);

    if (this.mode === 'main') {
      left.append(
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'ENDLESS PEEK'),
        h('p', { class: 'tagline' }, 'An endless hallway of held angles. Clear every corner like it’s ranked.'),
      );
      const play = h('button', { class: 'btn primary big' }, 'PLAY');
      play.onclick = () => this.cb.onPlay();
      left.append(play);
      left.append(this.bestBlock());
      left.append(this.howTo());
    } else if (this.mode === 'pause') {
      left.append(h('div', { class: 'brand small' }, 'PAUSED'));
      const resume = h('button', { class: 'btn primary big' }, 'RESUME');
      resume.onclick = () => this.cb.onResume();
      const restart = h('button', { class: 'btn' }, 'RESTART RUN');
      restart.onclick = () => this.cb.onRestart();
      const quit = h('button', { class: 'btn ghost' }, 'MAIN MENU');
      quit.onclick = () => this.cb.onQuit();
      left.append(resume, restart, quit, h('p', { class: 'hint' }, 'Click RESUME or the game to lock the mouse again.'));
    } else if (this.results) {
      left.append(this.resultsBlock());
    }
    right.append(this.settingsPanel());
  }

  private bestBlock(): HTMLElement {
    const best = this.best();
    const rows = (Object.keys(DIFFICULTIES) as Difficulty[])
      .filter((d) => best[d])
      .map((d) => h('div', { class: 'best-row' }, h('span', {}, DIFFICULTIES[d].label), h('b', {}, `Room ${best[d]!.rooms}`), h('span', {}, `${best[d]!.kills} kills`)));
    if (rows.length === 0) return h('div', {});
    return h('div', { class: 'best' }, h('div', { class: 'section-label' }, 'BEST RUNS (SURVIVAL)'), ...rows);
  }

  private howTo(): HTMLElement {
    const b = this.settings.binds;
    return h(
      'div',
      { class: 'howto' },
      h('div', { class: 'section-label' }, 'HOW IT WORKS'),
      h(
        'ul',
        {},
        h('li', {}, 'Bots hold random angles: alcoves, door corners, behind cover, high ground. They react like players: a few hundred ms after any part of you shows.'),
        h('li', {}, 'Slice the pie, pre-aim head level, counter-strafe before you shoot. Running is loud: walking keeps them unaware.'),
        h('li', {}, 'Re-peeking an angle you just showed is punished: the bot is pre-aimed and reacts faster.'),
        h('li', {}, `Move ${bindLabel(b.forward)}${bindLabel(b.left)}${bindLabel(b.back)}${bindLabel(b.right)} · Walk ${bindLabel(b.walk)} · Crouch ${bindLabel(b.crouch)} · Jump ${bindLabel(b.jump)} · Reload ${bindLabel(b.reload)} · Weapons ${bindLabel(b.primary)}/${bindLabel(b.secondary)}/${bindLabel(b.melee)} · Restart ${bindLabel(b.restart)} · Pause Esc`),
      ),
    );
  }

  private resultsBlock(): HTMLElement {
    const r = this.results!;
    const s = r.stats;
    const wrap = h('div', { class: 'results' });
    wrap.append(h('div', { class: 'brand small' }, r.survival ? 'ELIMINATED' : 'RUN OVER'));
    if (r.newBest) wrap.append(h('div', { class: 'new-best' }, 'NEW BEST'));
    const grid = h('div', { class: 'stat-grid' });
    const stat = (label: string, value: string) => grid.append(h('div', { class: 'stat' }, h('b', {}, value), h('span', {}, label)));
    stat('Rooms', String(s.rooms));
    stat('Kills', String(s.kills));
    stat('Time', fmtTime(s.duration(r.now)));
    stat('Median TTK', fmtMs(s.medianTtk));
    stat('Median placement', s.medianPlacement === null ? '-' : `${s.medianPlacement.toFixed(1)}°`);
    stat('Headshot %', `${Math.round(s.headshotRate * 100)}%`);
    stat('Accuracy', `${Math.round(s.accuracy * 100)}%`);
    stat('Saw them first', s.sawFirstRate === null ? '-' : `${Math.round(s.sawFirstRate * 100)}%`);
    if (!r.survival) stat('Deaths', String(s.deaths));
    wrap.append(grid);
    if (s.death) {
      const d = s.death;
      const lines = [
        `Killed from ${TAG_PHRASES[d.tag]}, ${d.distance.toFixed(1)} m away (${d.region === 'head' ? 'headshot' : `${d.region} shot`}).`,
        d.youSawFirst
          ? `You had it on screen first${d.placement !== null ? `, crosshair ${d.placement.toFixed(1)}° off its head` : ''}, then it out-reacted you.`
          : 'It saw you before it was on your screen: you peeked into it blind.',
        `It reacted in ${fmtMs(d.reaction)} and you were exposed for ${fmtMs(d.exposed)}.`,
      ];
      wrap.append(h('div', { class: 'recap' }, h('div', { class: 'section-label' }, 'DEATH RECAP'), ...lines.map((l) => h('p', {}, l))));
    }
    const weak = s.weakestAngle();
    if (weak) wrap.append(h('p', { class: 'hint' }, `Slowest angle type: ${TAG_LABELS[weak.tag]} (median ${fmtMs(weak.ttk)}).`));
    const again = h('button', { class: 'btn primary big' }, 'PLAY AGAIN');
    again.onclick = () => this.cb.onRestart();
    const quit = h('button', { class: 'btn ghost' }, 'MAIN MENU');
    quit.onclick = () => this.cb.onQuit();
    wrap.append(again, quit, h('p', { class: 'hint' }, `Press ${bindLabel(this.settings.binds.restart)} or Space to go again.`));
    return wrap;
  }

  private settingsPanel(): HTMLElement {
    const panel = h('div', { class: 'settings' });
    const tabs = h('div', { class: 'tabs' });
    const names: [Tab, string][] = [
      ['gameplay', 'GAMEPLAY'],
      ['mouse', 'MOUSE'],
      ['crosshair', 'CROSSHAIR'],
      ['controls', 'CONTROLS'],
      ['video', 'VIDEO & AUDIO'],
    ];
    for (const [id, label] of names) {
      const t = h('button', { class: `tab${this.tab === id ? ' active' : ''}` }, label);
      t.onclick = () => {
        this.tab = id;
        this.render();
      };
      tabs.append(t);
    }
    const body = h('div', { class: 'tab-body' });
    panel.append(tabs, body);
    switch (this.tab) {
      case 'gameplay':
        this.gameplayTab(body);
        break;
      case 'mouse':
        this.mouseTab(body);
        break;
      case 'crosshair':
        this.crosshairTab(body);
        break;
      case 'controls':
        this.controlsTab(body);
        break;
      case 'video':
        this.videoTab(body);
        break;
    }
    return panel;
  }

  private row(label: string, control: HTMLElement, hint?: string): HTMLElement {
    const r = h('label', { class: 'row' }, h('span', { class: 'row-label' }, label), control);
    if (hint) r.append(h('span', { class: 'row-hint' }, hint));
    return r;
  }

  private select<K extends keyof Settings>(key: K, options: [Settings[K], string][], after?: () => void): HTMLSelectElement {
    const sel = h('select', {});
    options.forEach(([v, label], i) => {
      const o = h('option', { value: String(i) }, label);
      if (v === this.settings[key]) o.selected = true;
      sel.append(o);
    });
    sel.onchange = () => {
      this.settings[key] = options[Number(sel.value)][0];
      this.change([key]);
      after?.();
    };
    return sel;
  }

  private toggle(key: keyof Settings): HTMLInputElement {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = Boolean(this.settings[key]);
    cb.onchange = () => {
      (this.settings[key] as boolean) = cb.checked;
      this.change([key]);
    };
    return cb;
  }

  private number(key: keyof Settings, min: number, max: number, step: number, after?: () => void): HTMLInputElement {
    const inp = h('input', { type: 'number', min: String(min), max: String(max), step: String(step) });
    inp.value = String(this.settings[key]);
    inp.onchange = () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      (this.settings[key] as number) = Math.min(max, Math.max(min, v));
      inp.value = String(this.settings[key]);
      this.change([key]);
      after?.();
    };
    return inp;
  }

  private gameplayTab(body: HTMLElement): void {
    body.append(
      this.row(
        'Mode',
        this.select('mode', [
          ['survival', 'Survival: one life, go as deep as you can'],
          ['practice', 'Practice: deaths are counted, the run continues'],
        ]),
      ),
      this.row('Primary', this.select('primary', PRIMARY_IDS.map((id) => [id, `${WEAPONS[id].name}`]))),
      this.row('Secondary', this.select('secondary', SECONDARY_IDS.map((id) => [id, WEAPONS[id].name]))),
      this.row(
        'Bot difficulty',
        this.select(
          'difficulty',
          (Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => [d, `${DIFFICULTIES[d].label} · ~${Math.round(DIFFICULTIES[d].reaction[0] * 1000)} ms reaction`]),
        ),
      ),
      this.row(
        'Bots per room',
        this.select('density', [
          ['low', 'Low (0-1)'],
          ['normal', 'Normal (1-3)'],
          ['high', 'High (2-4)'],
        ]),
      ),
      this.row('Bots shoot back', this.toggle('botsShoot')),
      this.row(
        'Bot shields',
        this.select('botArmor', [
          ['heavy', 'Heavy (50)'],
          ['light', 'Light (25)'],
          ['none', 'None'],
        ]),
      ),
      this.row(
        'Your shields',
        this.select('playerArmor', [
          ['heavy', 'Heavy (50)'],
          ['light', 'Light (25)'],
          ['none', 'None'],
        ]),
      ),
      this.row('Heal between rooms', this.toggle('healBetweenRooms'), 'Full HP, shields and ammo each new room, like a new round.'),
      this.row('Show hitboxes', this.toggle('showHitboxes')),
      this.row('Live stats panel', this.toggle('showStatsPanel')),
      this.row('Seed', this.seedInput(), 'Blank = random hallway each run. Same seed = same hallway.'),
      h('p', { class: 'hint' }, 'Mode, weapons, difficulty, density and shields apply from the next run.'),
    );
  }

  private seedInput(): HTMLInputElement {
    const inp = h('input', { type: 'text', placeholder: 'random', maxlength: '12' });
    inp.value = this.settings.seed;
    inp.onchange = () => {
      this.settings.seed = inp.value.trim();
      this.change(['seed']);
    };
    return inp;
  }

  private mouseTab(body: HTMLElement): void {
    const info = h('div', { class: 'sens-info' });
    const refresh = () => {
      const s = this.settings;
      info.textContent = `eDPI ${Math.round(edpi(s.sensitivity, s.dpi))} · ${cmPer360(s.sensitivity, s.dpi).toFixed(1)} cm/360 · ${(0.07 * s.sensitivity).toFixed(4)}°/count`;
    };
    refresh();
    const convInput = h('input', { type: 'number', step: '0.01', placeholder: 'their sens' });
    const convGame = h('select', {});
    for (const g of Object.keys(OTHER_GAMES)) convGame.append(h('option', { value: g }, g));
    const convBtn = h('button', { class: 'btn small' }, 'Convert');
    const sensInput = this.number('sensitivity', 0.001, 10, 0.001, refresh);
    convBtn.onclick = (e) => {
      e.preventDefault();
      const v = Number(convInput.value);
      if (!Number.isFinite(v) || v <= 0) return;
      this.settings.sensitivity = Math.round(convertFrom(convGame.value, v) * 1000) / 1000;
      sensInput.value = String(this.settings.sensitivity);
      this.change(['sensitivity']);
      refresh();
    };
    const raw =
      this.rawActive === null
        ? 'Raw input is checked when you start playing.'
        : this.rawActive
          ? 'Raw input is ACTIVE: movement is counted straight from your mouse.'
          : 'Raw input is NOT available in this browser/OS. Set Windows pointer speed to 6/11 and turn off Enhance Pointer Precision for a 1:1 match.';
    body.append(
      this.row('Sensitivity (VALORANT)', sensInput, 'Same number as your in-game Sensitivity: Aim.'),
      this.row('Scoped sensitivity multiplier', this.number('scopedMultiplier', 0.01, 5, 0.01), 'Same as in-game. Applies to every ADS zoom and scope.'),
      this.row('Mouse DPI (for the readout)', this.number('dpi', 50, 32000, 50, refresh)),
      info,
      this.row('Convert from', h('span', { class: 'inline' }, convGame, convInput, convBtn)),
      this.row('Raw input', this.toggle('rawInput'), raw),
      this.row('Invert mouse', this.toggle('invertY')),
      this.row(
        'Aim down sights',
        this.select('adsHold', [
          [true, 'Hold'],
          [false, 'Toggle'],
        ]),
      ),
      this.row(
        'Sniper scope',
        this.select('scopeHold', [
          [false, 'Toggle (cycles zoom levels)'],
          [true, 'Hold'],
        ]),
      ),
      this.row(
        'Walk',
        this.select('walkToggle', [
          [false, 'Hold'],
          [true, 'Toggle'],
        ]),
      ),
      this.row(
        'Crouch',
        this.select('crouchToggle', [
          [false, 'Hold'],
          [true, 'Toggle'],
        ]),
      ),
    );
  }

  private crosshairTab(body: HTMLElement): void {
    const box = h('div', { class: 'xhair-preview' });
    body.append(box);
    const view = new CrosshairView(box);
    view.el.classList.add('preview');
    const draw = () => {
      try {
        const cfg = parseCrosshairCode(this.settings.crosshairCode);
        view.draw(cfg.primary, 3, 0, 0);
      } catch {
        view.clear();
      }
    };
    requestAnimationFrame(() => {
      view.el.style.left = `calc(50% - ${view.el.style.width} / 2)`;
      view.el.style.top = `calc(50% - ${view.el.style.height} / 2)`;
      draw();
    });

    const code = h('input', { type: 'text', class: 'code', spellcheck: 'false' });
    code.value = this.settings.crosshairCode;
    const msg = h('span', { class: 'row-hint' }, 'Paste a VALORANT crosshair code (Settings > Crosshair > Import Profile Code in game).');
    const apply = (value: string) => {
      try {
        const cfg = parseCrosshairCode(value);
        this.settings.crosshairCode = serializeCrosshairCode(cfg) === '0;P' ? '0' : value.trim();
        this.change(['crosshairCode']);
        // Rebuild the tab so the quick-edit controls reflect the imported code.
        this.render();
      } catch (e) {
        msg.textContent = e instanceof CrosshairCodeError ? e.message : 'That code could not be read.';
      }
    };
    const importBtn = h('button', { class: 'btn small' }, 'Import');
    importBtn.onclick = (e) => {
      e.preventDefault();
      apply(code.value);
    };
    const copyBtn = h('button', { class: 'btn small ghost' }, 'Copy');
    copyBtn.onclick = (e) => {
      e.preventDefault();
      void navigator.clipboard?.writeText(this.settings.crosshairCode).then(() => (msg.textContent = 'Copied.'));
    };
    body.append(this.row('Profile code', h('span', { class: 'inline' }, code, importBtn, copyBtn)), msg);

    const presets = h('div', { class: 'presets' });
    for (const [name, c] of CROSSHAIR_PRESETS) {
      const b = h('button', { class: 'btn small ghost' }, name);
      b.onclick = (e) => {
        e.preventDefault();
        apply(c);
      };
      presets.append(b);
    }
    body.append(h('div', { class: 'section-label' }, 'PRESETS'), presets);

    // Quick edits for the most common settings; everything else via code.
    let cfg;
    try {
      cfg = parseCrosshairCode(this.settings.crosshairCode);
    } catch {
      cfg = parseCrosshairCode('0');
    }
    const p = cfg.primary;
    const commit = () => {
      cfg.ads = cfg.separateAds ? cfg.ads : structuredClone(cfg.primary);
      apply(serializeCrosshairCode(cfg));
    };
    const color = h('select', {});
    CROSSHAIR_COLORS.forEach((c, i) => {
      const o = h('option', { value: String(i) }, c.name);
      if (p.colorIndex === i) o.selected = true;
      color.append(o);
    });
    color.onchange = () => {
      p.colorIndex = Number(color.value);
      commit();
    };
    const chk = (get: () => boolean, set: (v: boolean) => void) => {
      const c = h('input', { type: 'checkbox' });
      c.checked = get();
      c.onchange = () => {
        set(c.checked);
        commit();
      };
      return c;
    };
    const num = (get: () => number, set: (v: number) => void, min: number, max: number, step = 1) => {
      const n = h('input', { type: 'number', min: String(min), max: String(max), step: String(step) });
      n.value = String(get());
      n.onchange = () => {
        set(Math.min(max, Math.max(min, Number(n.value) || 0)));
        commit();
      };
      return n;
    };
    body.append(
      h('div', { class: 'section-label' }, 'QUICK EDIT (PRIMARY)'),
      this.row('Color', color),
      this.row('Outlines', chk(() => p.outlines, (v) => (p.outlines = v))),
      this.row('Center dot', chk(() => p.centerDot, (v) => (p.centerDot = v))),
      this.row('Inner lines', chk(() => p.inner.show, (v) => (p.inner.show = v))),
      this.row('Inner length', num(() => p.inner.length, (v) => (p.inner.length = v), 0, 20)),
      this.row('Inner thickness', num(() => p.inner.thickness, (v) => (p.inner.thickness = v), 0, 10)),
      this.row('Inner offset', num(() => p.inner.offset, (v) => (p.inner.offset = v), 0, 20)),
      this.row('Inner firing error', chk(() => p.inner.firingError, (v) => (p.inner.firingError = v))),
      this.row('Outer lines', chk(() => p.outer.show, (v) => (p.outer.show = v))),
      this.row('Fade with firing error', chk(() => p.fadeWithFiringError, (v) => (p.fadeWithFiringError = v))),
    );
  }

  private controlsTab(body: HTMLElement): void {
    for (const action of Object.keys(ACTION_LABELS) as Action[]) {
      const b = h('button', { class: `btn small bind${this.capturing === action ? ' capturing' : ''}` }, this.capturing === action ? 'Press a key…' : bindLabel(this.settings.binds[action]));
      b.onclick = (e) => {
        e.preventDefault();
        this.capturing = action;
        this.render();
      };
      body.append(this.row(ACTION_LABELS[action], b));
    }
    const reset = h('button', { class: 'btn small ghost' }, 'Reset to VALORANT defaults');
    reset.onclick = (e) => {
      e.preventDefault();
      this.settings.binds = { ...DEFAULT_BINDS };
      this.change(['binds']);
      this.render();
    };
    body.append(reset);
    const firefox = /firefox/i.test(navigator.userAgent);
    body.append(
      h(
        'p',
        { class: 'hint' },
        firefox
          ? 'Firefox can’t block Ctrl+W, so crouch+forward may close the tab. Rebind crouch (e.g. C) or keep the leave-page prompt.'
          : 'In fullscreen the game locks the keyboard, so Ctrl+W (crouch + forward) can’t close the tab.',
      ),
    );
  }

  private captureKey(e: KeyboardEvent): void {
    if (!this.capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      this.settings.binds[this.capturing] = e.code;
      this.change(['binds']);
    }
    this.capturing = null;
    this.render();
  }

  private captureMouse(e: MouseEvent): void {
    if (!this.capturing) return;
    const target = e.target as HTMLElement;
    if (target.classList.contains('bind')) return;
    e.preventDefault();
    e.stopPropagation();
    this.settings.binds[this.capturing] = `Mouse${e.button}`;
    this.change(['binds']);
    this.capturing = null;
    this.render();
  }

  private videoTab(body: HTMLElement): void {
    body.append(
      this.row(
        'Aspect ratio',
        this.select('aspectMode', [
          ['letterbox', '16:9 letterbox (like VALORANT)'],
          ['stretch', 'Stretch to fill'],
        ]),
        'VALORANT always renders 103° x 70.53° in a 16:9 frame.',
      ),
      this.row('Fullscreen on play', this.toggle('fullscreenOnPlay')),
      this.row(
        'Render scale',
        this.select('renderScale', [
          [1, '100%'],
          [0.85, '85%'],
          [0.7, '70%'],
          [0.5, '50%'],
        ]),
      ),
      this.row('Anti-aliasing (reloads page)', this.toggle('antialias')),
      this.row('Shadows', this.toggle('shadows')),
      this.row('Show FPS', this.toggle('showFps')),
      this.row(
        'Enemy highlight color',
        this.select('enemyHighlight', [
          ['red', 'Red (default)'],
          ['yellow', 'Yellow (deuteranopia)'],
          ['purple', 'Purple (tritanopia)'],
        ]),
      ),
      this.row('Volume', this.volumeSlider()),
      h('p', { class: 'hint' }, 'For the lowest input lag use Chrome or Edge in fullscreen. Browsers cap FPS at your monitor refresh rate.'),
    );
    const reset = h('button', { class: 'btn small ghost' }, 'Reset all settings');
    reset.onclick = (e) => {
      e.preventDefault();
      Object.assign(this.settings, structuredClone(DEFAULT_SETTINGS));
      this.change(Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]);
      this.render();
    };
    body.append(reset);
  }

  private volumeSlider(): HTMLInputElement {
    const r = h('input', { type: 'range', min: '0', max: '1', step: '0.05' });
    r.value = String(this.settings.volume);
    r.oninput = () => {
      this.settings.volume = Number(r.value);
      this.change(['volume']);
    };
    return r;
  }
}
