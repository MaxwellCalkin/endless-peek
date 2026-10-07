/**
 * Camera math matching VALORANT.
 *
 * - Yaw and pitch: 0.07 degrees per mouse count at sensitivity 1.
 * - FOV: a fixed 16:9 frame, 103 degrees horizontal (70.53 vertical). Other aspect ratios are
 *   letterboxed or stretched; they never see more or less of the world.
 * - Zoom divides the horizontal angle linearly: 1.25x ADS is 82.4 degrees.
 * - One scoped sensitivity multiplier for every zoom: deg/count = 0.07 * sens * mult / zoom.
 */

export const YAW_PER_COUNT = 0.07;
export const HFOV = 103;
export const ASPECT = 16 / 9;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function horizontalFov(zoom: number): number {
  return HFOV / Math.max(1, zoom);
}

/** Vertical FOV (degrees) of the 16:9 frame for a horizontal FOV. */
export function verticalFov(hfovDeg: number, aspect = ASPECT): number {
  return deg(2 * Math.atan(Math.tan(rad(hfovDeg) / 2) / aspect));
}

/** Degrees of rotation per mouse count. */
export function degreesPerCount(sens: number, zoom = 1, scopedMult = 1): number {
  return zoom > 1 ? (YAW_PER_COUNT * sens * scopedMult) / zoom : YAW_PER_COUNT * sens;
}

/** Centimeters of mouse travel for a full 360 degree turn. */
export function cmPer360(sens: number, dpi: number): number {
  const counts = 360 / degreesPerCount(sens);
  return (counts / dpi) * 2.54;
}

/** eDPI as players quote it (DPI x sensitivity). */
export function edpi(sens: number, dpi: number): number {
  return sens * dpi;
}

/** Convert a sensitivity from another game by matching degrees per count. */
export const OTHER_GAMES: Record<string, number> = {
  'CS2 / CS:GO': 0.022,
  'Apex Legends': 0.022,
  'Overwatch 2': 0.0066,
};

export function convertFrom(game: keyof typeof OTHER_GAMES, sens: number): number {
  return (sens * OTHER_GAMES[game]) / YAW_PER_COUNT;
}

/** Pixels from the screen center per degree at the center, for a frame `heightPx` tall. */
export function pixelsPerDegree(heightPx: number, zoom = 1): number {
  const v = rad(verticalFov(horizontalFov(zoom)));
  return (heightPx / 2 / Math.tan(v / 2)) * Math.tan(rad(1));
}

/** Screen-space size of an angle off center, used to expand the crosshair with spread. */
export function errorToPixels(errorDeg: number, heightPx: number, zoom = 1): number {
  const v = rad(verticalFov(horizontalFov(zoom)));
  return (heightPx / 2) * (Math.tan(rad(errorDeg)) / Math.tan(v / 2));
}

/** Where the 16:9 game frame sits inside a window, in CSS pixels. */
export function frameRect(
  width: number,
  height: number,
  mode: 'letterbox' | 'stretch',
): { x: number; y: number; w: number; h: number } {
  if (mode === 'stretch') return { x: 0, y: 0, w: width, h: height };
  if (width / height > ASPECT) {
    const w = Math.round(height * ASPECT);
    return { x: Math.floor((width - w) / 2), y: 0, w, h: height };
  }
  const h = Math.round(width / ASPECT);
  return { x: 0, y: Math.floor((height - h) / 2), w: width, h };
}
