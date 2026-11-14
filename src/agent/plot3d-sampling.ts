import type { Plot3DDomain } from "../core/contracts/plot3d.ts";
import type { PlotExpression } from "./plot-expression.ts";
import { expressionInterval, type Interval } from "./plot3d-interval.ts";
export type Vector3 = [number, number, number];
export interface CurveSample {
  u: number;
  x: number;
  y: number;
  z: number;
}
interface Quality {
  tolerance?: number;
  maxEvaluations?: number;
  maxDepth?: number;
}
function grid(
  domain: Plot3DDomain,
  intervals: number,
  seeds: number[] = [],
): number[] {
  const values = Array.from({ length: intervals + 1 }, (_, i) =>
    i === intervals
      ? domain[1]
      : domain[0] + ((domain[1] - domain[0]) * i) / intervals,
  );
  const sorted = [...new Set([...values, ...seeds])].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++)
    if (!(sorted[i]! > sorted[i - 1]!))
      throw new Error("Indistinguishable sampling coordinates");
  return sorted;
}
function intervalState(
  asts: PlotExpression[],
  environment: Record<string, Interval>,
) {
  const checks = asts.map((ast) => expressionInterval(ast, environment));
  return {
    invalid: checks.some((c) => c.state === "undefined"),
    safe: checks.every((c) => c.state === "safe" && !c.oscillatory),
  };
}
export function sampleParametricCurve(
  evaluate: (u: number) => Vector3,
  options: {
    uDomain: Plot3DDomain;
    axisDomains: [Plot3DDomain, Plot3DDomain, Plot3DDomain];
    seedU?: number[];
    asts: PlotExpression[];
    quality?: Quality;
  },
) {
  const { quality = {} } = options;
  const tolerance = quality.tolerance ?? 0.001,
    maxEvaluations = quality.maxEvaluations ?? 16384,
    maxDepth = quality.maxDepth ?? 16;
  const cache = new Map<number, Vector3>();
  const segments: CurveSample[][] = [];
  let current: CurveSample[] = [],
    maxObservedError = 0;
  const spans = options.axisDomains.map((d) => d[1] - d[0]);
  function at(u: number) {
    let v = cache.get(u);
    if (!v) {
      if (cache.size >= maxEvaluations)
        throw new Error(
          "Curve sampling budget exhausted; narrow uDomain or simplify the expression",
        );
      v = evaluate(u);
      cache.set(u, v);
    }
    return v;
  }
  function gap() {
    if (current.length > 1) segments.push(current);
    current = [];
  }
  function add(u: number, v: Vector3) {
    if (current.at(-1)?.u !== u) current.push({ u, x: v[0], y: v[1], z: v[2] });
  }
  function refine(a: number, b: number, depth: number) {
    const check = intervalState(options.asts, { u: [a, b] });
    if (check.invalid) {
      gap();
      return;
    }
    const va = at(a),
      vb = at(b);
    const us = [a + (b - a) / 4, a + (b - a) / 2, a + (3 * (b - a)) / 4];
    if (!(us[1]! > a && us[1]! < b))
      throw new Error(
        "Curve domain has indistinguishable refinement coordinates",
      );
    const probes = us.map(at);
    const finite = [va, vb, ...probes].every((v) => v.every(Number.isFinite));
    let error = Infinity;
    if (finite)
      error = Math.max(
        ...probes.map((v, i) =>
          Math.hypot(
            ...v.map(
              (n, j) =>
                (n - (va[j]! + ((vb[j]! - va[j]!) * (i + 1)) / 4)) / spans[j]!,
            ),
          ),
        ),
      );
    if (check.safe && finite && error <= tolerance) {
      maxObservedError = Math.max(maxObservedError, error);
      add(a, va);
      add(b, vb);
      return;
    }
    if (depth >= maxDepth)
      throw new Error(
        `Unresolved curve on u=[${a},${b}]; supply separate continuous branch domains or feature seeds`,
      );
    refine(a, us[1]!, depth + 1);
    refine(us[1]!, b, depth + 1);
  }
  const initial = grid(options.uDomain, 64, options.seedU);
  for (let i = 1; i < initial.length; i++)
    refine(initial[i - 1]!, initial[i]!, 0);
  gap();
  if (!segments.length)
    throw new Error("Curve is undefined throughout uDomain");
  return { segments, evaluations: cache.size, maxObservedError };
}
export function sampleAnalyticSurface(
  evaluate: (x: number, y: number) => number,
  options: {
    xDomain: Plot3DDomain;
    yDomain: Plot3DDomain;
    zDomain: Plot3DDomain;
    seedX?: number[];
    seedY?: number[];
    ast: PlotExpression;
    quality?: Quality;
  },
) {
  const cache = new Map<string, number>();
  const tolerance = options.quality?.tolerance ?? 0.001,
    budget = options.quality?.maxEvaluations ?? 66049;
  const span = options.zDomain[1] - options.zDomain[0];
  function at(x: number, y: number) {
    const key = `${x},${y}`;
    if (!cache.has(key)) {
      if (cache.size >= budget)
        throw new Error(
          "Surface sampling budget exhausted; narrow its domains or simplify the expression",
        );
      cache.set(key, evaluate(x, y));
    }
    return cache.get(key)!;
  }
  for (let intervals = 16; intervals <= 128; intervals *= 2) {
    const x = grid(options.xDomain, intervals, options.seedX),
      y = grid(options.yDomain, intervals, options.seedY);
    if (x.length * y.length > 16641)
      throw new Error(
        "Surface vertex budget exhausted by refinement/feature seeds",
      );
    const z: Array<Array<number | null>> = y.map((yy) =>
      x.map((xx) => {
        const v = at(xx, yy);
        return Number.isFinite(v) ? v : null;
      }),
    );
    let unresolved = false,
      maxObservedError = 0;
    const mask = new Set<string>();
    for (let j = 0; j < y.length - 1; j++)
      for (let i = 0; i < x.length - 1; i++) {
        const xa = x[i]!,
          xb = x[i + 1]!,
          ya = y[j]!,
          yb = y[j + 1]!;
        const state = intervalState([options.ast], {
          x: [xa, xb],
          y: [ya, yb],
        });
        if (state.invalid) {
          for (const [ii, jj] of [
            [i, j],
            [i + 1, j],
            [i, j + 1],
            [i + 1, j + 1],
          ])
            mask.add(`${ii},${jj}`);
          continue;
        }
        if (!state.safe) {
          unresolved = true;
          continue;
        }
        const a = z[j]![i],
          b = z[j]![i + 1],
          c = z[j + 1]![i],
          d = z[j + 1]![i + 1];
        if ([a, b, c, d].some((v) => v === null)) {
          unresolved = true;
          continue;
        }
        const probes: [[number, number], ...Array<[number, number]>] = [
          [0.5, 0.5],
          [0.5, 0],
          [0.5, 1],
          [0, 0.5],
          [1, 0.5],
        ];
        for (const [s, t] of probes) {
          const observed = at(xa + (xb - xa) * s, ya + (yb - ya) * t);
          const diag1 =
            t <= s
              ? a! * (1 - s) + b! * (s - t) + d! * t
              : a! * (1 - t) + c! * (t - s) + d! * s;
          const diag2 =
            s + t <= 1
              ? a! * (1 - s - t) + b! * s + c! * t
              : b! * (1 - t) + c! * (1 - s) + d! * (s + t - 1);
          const error =
            Math.max(Math.abs(observed - diag1), Math.abs(observed - diag2)) /
            span;
          if (!Number.isFinite(error) || error > tolerance) unresolved = true;
          else maxObservedError = Math.max(maxObservedError, error);
        }
      }
    if (!unresolved) {
      for (const key of mask) {
        const [i, j] = key.split(",").map(Number);
        z[j!]![i!] = null;
      }
      if (!z.some((row) => row.some((v) => v !== null)))
        throw new Error("Surface is undefined throughout its domains");
      return { x, y, z, evaluations: cache.size, maxObservedError };
    }
  }
  throw new Error(
    "Unresolved surface approximation or continuity; supply continuous rectangular branch domains, feature seeds or a simpler expression",
  );
}
