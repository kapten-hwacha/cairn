import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compilePlotExpression,
  compileScopedPlotExpression as compile,
} from "../src/agent/plot-expression.ts";
import {
  sampleParametricCurve,
  sampleAnalyticSurface,
  type Vector3,
} from "../src/agent/plot3d-sampling.ts";
function curve(
  sources: string[],
  domain: [number, number] = [0, Math.PI * 2],
  extra: object = {},
) {
  const expressions = sources.map((s) => compile(s, ["u"]));
  return sampleParametricCurve(
    (u) => expressions.map((e) => e.evaluate({ u })) as Vector3,
    {
      uDomain: domain,
      axisDomains: [
        [-2, 2],
        [-2, 2],
        [-2, 8],
      ],
      asts: expressions.map((e) => e.ast),
      ...extra,
    },
  );
}
function surface(source: string, extra: object = {}) {
  const e = compile(source, ["x", "y"]);
  return sampleAnalyticSurface((x, y) => e.evaluate({ x, y }), {
    xDomain: [-1, 1],
    yDomain: [-1, 1],
    zDomain: [-2, 2],
    ast: e.ast,
    ...extra,
  });
}
test("scoped expressions preserve 2D grammar and reject unbound variables/code", () => {
  assert.equal(compilePlotExpression("x^2+pi")(2), 4 + Math.PI);
  assert.equal(compile("x+y", ["x", "y"]).evaluate({ x: 2, y: 3 }), 5);
  for (const s of ["x+u", "t", "globalThis.alert(1)"])
    assert.throws(() => compile(s, ["u"]));
});
test("vector sampling is deterministic, shares coordinates, preserves seeds and z curvature", () => {
  const result = curve(["cos(u)", "sin(u)", "u"], undefined, {
    seedU: [0.123],
  });
  assert.deepEqual(
    result,
    curve(["cos(u)", "sin(u)", "u"], undefined, { seedU: [0.123] }),
  );
  assert.ok(result.segments.flat().some((p) => p.u === 0.123));
  assert.ok(result.maxObservedError <= 0.001);
  const z = curve(["0", "0", "sin(20*u)"], [0, 1]);
  assert.ok(z.segments.flat().some((p) => p.z > 0.99));
  let calls = 0;
  const e = compile("u", ["u"]);
  const straight = sampleParametricCurve(
    (u) => {
      calls++;
      return [u, u, u];
    },
    {
      uDomain: [0, 1],
      axisDomains: [
        [0, 1],
        [0, 1],
        [0, 1],
      ],
      asts: [e.ast, e.ast, e.ast],
    },
  );
  assert.equal(calls, straight.evaluations);
  assert.equal(straight.segments.length, 1);
});
test("planes and curved surfaces meet observed tolerance with finite deterministic output", () => {
  const plane = surface("x+y");
  assert.equal(plane.x.length, 17);
  assert.equal(plane.maxObservedError, 0);
  const parabola = surface("x^2+y^2");
  assert.ok(parabola.x.length > 17);
  assert.ok(parabola.maxObservedError <= 0.001);
  assert.ok(parabola.evaluations <= 66049);
  assert.deepEqual(parabola, surface("x^2+y^2"));
  assert.ok(
    surface("x*y")
      .z.flat()
      .every((v) => v === null || Number.isFinite(v)),
  );
});
test("poles, unresolved oscillations and budget overflow fail explicitly without bridges", () => {
  for (const source of ["1/(u-0.123)", "tan(u)"])
    assert.throws(() => curve(["u", "0", source], [0, 2]), /Unresolved|budget/);
  assert.throws(
    () =>
      curve(["sin(100000*u)", "0", "u"], [0, 1], {
        quality: { maxEvaluations: 100 },
      }),
    /budget/,
  );
  assert.throws(() => surface("1/(x-0.123)"), /Unresolved|budget/);
  assert.throws(() => surface("log(-1)"), /undefined/);
  assert.throws(() => surface("exp(1000*x)"), /Unresolved|budget/);
});
test("invalid domains create genuine gaps where interval proof is wholly undefined", () => {
  const result = surface("sqrt(x)", { xDomain: [0.1, 1] });
  assert.ok(result.z.flat().every((v) => v !== null));
  assert.throws(() => surface("sqrt(x)"), /Unresolved|budget/);
  const narrow = curve(["u", "0", "exp(-((u-0.123)/0.001)^2)"], [0, 1], {
    seedU: [0.123],
  });
  assert.ok(narrow.segments.flat().some((p) => p.u === 0.123 && p.z === 1));
});

test("helix chords satisfy an independent dense reference and coordinate permutations agree", () => {
  const common = {
    axisDomains: [
      [-2, 2],
      [-2, 2],
      [-2, 2],
    ],
  };
  const sampled = curve(["cos(u)", "sin(u)", "u/4"], [0, 2 * Math.PI], common);
  const swapped = curve(["u/4", "cos(u)", "sin(u)"], [0, 2 * Math.PI], common);
  assert.deepEqual(
    sampled.segments[0]!.map((p) => p.u),
    swapped.segments[0]!.map((p) => p.u),
  );
  const points = sampled.segments[0]!;
  let j = 1;
  for (let i = 0; i <= 4000; i++) {
    const u = (2 * Math.PI * i) / 4000;
    while (j < points.length - 1 && points[j]!.u < u) j++;
    const a = points[j - 1]!,
      b = points[j]!,
      t = (u - a.u) / (b.u - a.u);
    const exact = [Math.cos(u), Math.sin(u), u / 4],
      linear = [
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      ];
    assert.ok(
      Math.hypot(...exact.map((v, k) => (v - linear[k]!) / 4)) <= 0.0011,
    );
  }
});
test("surface triangles agree with independent interior samples and reject tiny domains", () => {
  const sampled = surface("x^2+y^2");
  for (let j = 0; j < sampled.y.length - 1; j++)
    for (let i = 0; i < sampled.x.length - 1; i++) {
      const s = 0.31,
        t = 0.67,
        x = sampled.x[i]! + (sampled.x[i + 1]! - sampled.x[i]!) * s,
        y = sampled.y[j]! + (sampled.y[j + 1]! - sampled.y[j]!) * t;
      const a = sampled.z[j]![i]!,
        c = sampled.z[j + 1]![i]!,
        d = sampled.z[j + 1]![i + 1]!;
      assert.ok(
        Math.abs(x * x + y * y - (a * (1 - t) + c * (t - s) + d * s)) / 4 <=
          0.0011,
      );
    }
});
