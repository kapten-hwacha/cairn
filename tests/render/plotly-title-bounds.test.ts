import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

interface Options {
  model: number[];
  view: number[];
  projection: number[];
  offset: number[];
  inkBounds: number[];
  scale: number;
  pixelScale: number;
  resolution: number[];
  angle: number;
  alignDir: number[];
  alignOpt: number[];
}
interface Adjustment {
  fits: boolean;
  angleRadians: number;
  shiftClip: number[];
  inkBoundsClip: number[];
}
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const options = (): Options => ({
  model: identity(),
  view: identity(),
  projection: identity(),
  offset: [0, 0, 0],
  inkBounds: [-0.5, -0.5, 0.5, 0.5],
  scale: 12,
  pixelScale: 1,
  resolution: [100, 100],
  angle: 0,
  alignDir: [1, 0, 0],
  alignOpt: [0, 0.5, 0],
});
const build = process.env.PLOTLY_MATH_BUILD_DIR;
const enabled = {
  skip: build ? false : "Set PLOTLY_MATH_BUILD_DIR to a title-bounds build",
};
const load = () =>
  createRequire(import.meta.url)(
    path.join(build!, "stackgl_modules/vendor/gl-axes3d/lib/title-bounds.js"),
  ) as (options: Options) => Adjustment;
const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function verifyBox(o: Options, r: Adjustment): void {
  assert.equal(r.fits, true);
  const [x0, y0, x1, y1] = r.inkBoundsClip;
  const ix = (4 * o.pixelScale) / o.resolution[0]!,
    iy = (4 * o.pixelScale) / o.resolution[1]!;
  assert.ok(
    x0! >= -1 + ix - 1e-6 &&
      x1! <= 1 - ix + 1e-6 &&
      y0! >= -1 + iy - 1e-6 &&
      y1! <= 1 - iy + 1e-6,
  );
  // Verify all four corners receive exactly the same translation, preserving
  // proportions and rotation. Identity transforms isolate screen placement.
  const cs = Math.cos(r.angleRadians),
    sn = Math.sin(r.angleRadians),
    sx = (2 * o.scale * o.pixelScale) / o.resolution[0]!,
    sy = (2 * o.scale * o.pixelScale) / o.resolution[1]!;
  const corners = [];
  for (const x of [o.inkBounds[0]!, o.inkBounds[2]!])
    for (const y of [o.inkBounds[1]!, o.inkBounds[3]!])
      corners.push([
        o.offset[0]! + sx * (cs * x - sn * y) + r.shiftClip[0]!,
        o.offset[1]! + sy * (sn * x + cs * y) + r.shiftClip[1]!,
      ]);
  near(Math.min(...corners.map((p) => p[0]!)), x0!);
  near(Math.max(...corners.map((p) => p[0]!)), x1!);
  near(Math.min(...corners.map((p) => p[1]!)), y0!);
  near(Math.max(...corners.map((p) => p[1]!)), y1!);
}
test(
  "one-em calibration retains in-bounds placement and does not mutate inputs",
  enabled,
  () => {
    const adjust = load(),
      o = options(),
      before = JSON.stringify(o),
      r = adjust(o);
    assert.deepEqual(r.shiftClip, [0, 0]);
    assert.equal(r.angleRadians, 0);
    near(r.inkBoundsClip[0]!, -0.12);
    near(r.inkBoundsClip[2]!, 0.12);
    verifyBox(o, r);
    assert.equal(JSON.stringify(o), before);
  },
);
test(
  "each edge and corner uses the nearest uniform shift with a two CSS pixel inset",
  enabled,
  () => {
    const adjust = load();
    for (const [x, y] of [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
      [-2, -2],
      [2, -2],
      [-2, 2],
      [2, 2],
      [0.98, 0.98],
    ]) {
      const o = { ...options(), offset: [x!, y!, 0] };
      const r = adjust(o);
      verifyBox(o, r);
      near(r.shiftClip[0]!, Math.min(0.84, Math.max(-0.84, x!)) - x!);
      near(r.shiftClip[1]!, Math.min(0.84, Math.max(-0.84, y!)) - y!);
    }
  },
);
test(
  "rotated asymmetric titles fit non-square viewports and pixel scales 1/2",
  enabled,
  () => {
    const adjust = load();
    for (const angle of [0, 0.3, -0.8, Math.PI / 2, Math.PI])
      for (const pixelScale of [1, 2]) {
        const o = {
          ...options(),
          offset: [1.4, -1.2, 0],
          inkBounds: [-1, -0.3, 0.8, 0.5],
          resolution: [240, 120],
          pixelScale,
          angle,
        };
        verifyBox(o, adjust(o));
      }
  },
);
test(
  "all native alignment options resolve one angle shared by CPU bounds and shader",
  enabled,
  () => {
    const adjust = load();
    for (const mode of [-2, -1, 0, 1, 2, 3, 4, 8, 12])
      for (const direction of [
        [1, 1, 0],
        [-1, 1, 0],
        [-1, -1, 0],
        [1, -1, 0],
      ]) {
        const o = {
          ...options(),
          offset: [1.2, 1.2, 0],
          inkBounds: [-1, -0.3, 1, 0.3],
          resolution: [320, 200],
          alignDir: direction,
          alignOpt: [mode, 0.5, 1],
        };
        const r = adjust(o);
        verifyBox(o, r);
        assert.equal(r.angleRadians, Math.fround(r.angleRadians));
        if (mode === -1) near(r.angleRadians, 0);
      }
  },
);
test(
  "oversized titles return an explicit failure with zero displacement",
  enabled,
  () => {
    const adjust = load();
    for (const o of [
      { ...options(), inkBounds: [-20, -1, 20, 1] },
      { ...options(), resolution: [3, 3] },
    ]) {
      const before = JSON.stringify(o),
        r = adjust(o);
      assert.equal(r.fits, false);
      assert.deepEqual(r.shiftClip, [0, 0]);
      assert.equal(JSON.stringify(o), before);
    }
  },
);
test(
  "invalid transforms fail explicitly while valid projection preserves placement math",
  enabled,
  () => {
    const adjust = load();
    for (const mutate of [
      (o: Options) => {
        o.model[0] = NaN;
      },
      (o: Options) => {
        o.resolution[1] = 0;
      },
      (o: Options) => {
        o.pixelScale = -1;
      },
      (o: Options) => {
        o.inkBounds = [1, 0, -1, 1];
      },
      (o: Options) => {
        o.offset = [0, 0];
      },
    ]) {
      const o = options();
      mutate(o);
      assert.throws(() => adjust(o), /Invalid title bounds/);
    }
    const o = options();
    o.model[12] = 0.5;
    o.view[13] = -0.25;
    o.projection[0] = 0.5;
    const r = adjust(o);
    assert.deepEqual(r.shiftClip, [0, 0]);
    near((r.inkBoundsClip[0]! + r.inkBoundsClip[2]!) / 2, 0.25);
    near((r.inkBoundsClip[1]! + r.inkBoundsClip[3]!) / 2, -0.25);
  },
);
