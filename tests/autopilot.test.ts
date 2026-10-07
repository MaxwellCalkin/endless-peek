import { describe, expect, it } from 'vitest';
import { Bot, DIFFICULTIES } from '../src/bots/bot';
import { AGENT, MOVEMENT } from '../src/config/agent';
import { DEFAULT_BINDS } from '../src/config/settings';
import { DEG, angleDelta } from '../src/core/math';
import { Autopilot, DEFAULT_PILOT, type PilotHost } from '../src/game/autopilot';
import { groundStep, wishDirection } from '../src/player/movement';

const TICK = 1 / 128;
const RUN = 5.4; // rifle run speed
const DEADZONE = 0.275 * RUN;
const b = DEFAULT_BINDS;

type Pt = { x: number; z: number };

/** A point-mass player on an empty floor, driven by the pilot's key presses through the real movement model. */
function world(path: Pt[][], opts: { angles?: { key: string; x: number; y: number; z: number }[]; bots?: Bot[]; clear?: (pos: Pt) => boolean } = {}) {
  const keys = new Set<string>();
  const presses: { code: string; time: number; speed: number; yaw: number; pitch: number; pos: Pt }[] = [];
  const s = { time: 0, yaw: 0, pitch: 0, pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const host: PilotHost = {
    get time() {
      return s.time;
    },
    binds: b,
    eye: () => ({ x: s.pos.x, y: AGENT.eyeStand, z: s.pos.z }),
    view: () => ({ yaw: s.yaw, pitch: s.pitch }),
    setView: (yaw, pitch) => {
      s.yaw = yaw;
      s.pitch = pitch;
    },
    speed: () => Math.hypot(s.vel.x, s.vel.z),
    velocity: () => ({ ...s.vel }),
    bots: () => opts.bots ?? [],
    currentSegment: () => 0,
    clear: () => (opts.clear ? opts.clear(s.pos) : true),
    waypoints: () => path.flatMap((seg, si) => seg.map((p, i) => ({ seg: si, i, ...p }))),
    angles: () => opts.angles ?? [],
    key: (code, down) => {
      if (down && !keys.has(code)) presses.push({ code, time: s.time, speed: Math.hypot(s.vel.x, s.vel.z), yaw: s.yaw, pitch: s.pitch, pos: { ...s.pos } });
      if (down) keys.add(code);
      else keys.delete(code);
    },
    weapon: () => ({ melee: false, ready: true, deadzone: DEADZONE }),
  };
  const step = (pilot: Autopilot) => {
    s.time += TICK;
    pilot.tick(TICK);
    const f = (keys.has(b.forward) ? 1 : 0) - (keys.has(b.back) ? 1 : 0);
    const r = (keys.has(b.right) ? 1 : 0) - (keys.has(b.left) ? 1 : 0);
    const max = keys.has(b.walk) ? RUN * AGENT.walkMult : RUN;
    groundStep(s.vel, wishDirection(f, r, s.yaw), max, TICK, MOVEMENT);
    s.pos.x += s.vel.x * TICK;
    s.pos.z += s.vel.z * TICK;
  };
  return { host, s, presses, step };
}

describe('demo autopilot', () => {
  it('follows a jogging walking line to the end without orbiting a waypoint', () => {
    // Two segments joined by a sharp sidestep with closely spaced points (where a naive
    // "steer at the next waypoint" chaser with momentum circles forever).
    const path = [
      [{ x: 0, z: 0 }, { x: 0, z: -8 }, { x: -2.5, z: -9.6 }, { x: -2.5, z: -10.6 }],
      [{ x: -2.5, z: -11.2 }, { x: 1, z: -11.8 }, { x: 1, z: -24 }],
    ];
    const w = world(path);
    const pilot = new Autopilot(w.host, { ...DEFAULT_PILOT });
    let turned = 0;
    let prevYaw = 0;
    let arrived = -1;
    for (let i = 0; i < 128 * 15 && arrived < 0; i++) {
      w.step(pilot);
      turned += Math.abs(angleDelta(prevYaw, w.s.yaw));
      prevYaw = w.s.yaw;
      if (Math.hypot(w.s.pos.x - 1, w.s.pos.z + 24) < 1) arrived = w.s.time;
    }
    expect(arrived).toBeGreaterThan(0);
    expect(arrived).toBeLessThan(9);
    // A couple of corners' worth of turning, not laps.
    expect(turned / DEG).toBeLessThan(400);
  });

  it('pre-aims an angle off to the side while still walking the line', () => {
    const path = [[{ x: 0, z: 0 }, { x: 0, z: -20 }]];
    // A hiding spot 6 m to the right, hidden until we're level with it.
    const angles = [{ key: '0:0', x: 6, y: AGENT.eyeStand, z: -12 }];
    const w = world(path, { angles, clear: (pos) => pos.z < -11 });
    const pilot = new Autopilot(w.host, { ...DEFAULT_PILOT });
    let maxOff = 0;
    let arrived = false;
    for (let i = 0; i < 128 * 12 && !arrived; i++) {
      w.step(pilot);
      if (w.s.pos.z > -11) maxOff = Math.max(maxOff, Math.abs(angleDelta(0, w.s.yaw)));
      arrived = w.s.pos.z < -19;
    }
    expect(arrived).toBe(true);
    expect(maxOff / DEG).toBeGreaterThan(25);
  });

  it('reacts, counter-strafes under the deadzone and taps the head', () => {
    const path = [[{ x: 0, z: 0 }, { x: 0, z: -40 }]];
    const bot = new Bot(3, 0, -18, Math.atan2(3, -18), 'stand', 'corner-far', 0, DIFFICULTIES.hard, 0.1, 'heavy');
    const w = world(path, { bots: [bot], clear: (pos) => pos.z < -6 });
    const pilot = new Autopilot(w.host, { ...DEFAULT_PILOT });
    let seenAt = -1;
    for (let i = 0; i < 128 * 10; i++) {
      w.step(pilot);
      if (seenAt < 0 && w.s.pos.z < -6) seenAt = w.s.time;
      if (w.presses.some((p) => p.code === b.fire)) break;
    }
    const shot = w.presses.find((p) => p.code === b.fire);
    expect(shot).toBeDefined();
    expect(shot!.time - seenAt).toBeGreaterThan(0.15); // human reaction, not instant
    expect(shot!.speed).toBeLessThanOrEqual(DEADZONE);
    expect(w.presses.some((p) => p.code === b.back && p.time > seenAt)).toBe(true); // counter-strafed
    const head = bot.headCenter();
    const yawTo = Math.atan2(-(head.x - shot!.pos.x), -(head.z - shot!.pos.z));
    const pitchTo = Math.atan2(head.y - AGENT.eyeStand, Math.hypot(head.x - shot!.pos.x, head.z - shot!.pos.z));
    expect(Math.hypot(angleDelta(shot!.yaw, yawTo), shot!.pitch - pitchTo) / DEG).toBeLessThan(DEFAULT_PILOT.tolerance + 0.05);
  });
});
