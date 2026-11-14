import type { PlotExpression } from "./plot-expression.ts";
export type Interval = readonly [number, number];
export interface IntervalResult {
  range: Interval;
  state: "safe" | "undefined" | "uncertain";
  oscillatory?: boolean;
}
const uncertain = (): IntervalResult => ({
  range: [-Infinity, Infinity],
  state: "uncertain",
});
const invalid = (): IntervalResult => ({
  range: [NaN, NaN],
  state: "undefined",
});
function result(lo: number, hi: number, oscillatory = false): IntervalResult {
  return Number.isFinite(lo) && Number.isFinite(hi)
    ? { range: [lo, hi], state: "safe", oscillatory }
    : uncertain();
}
/** Conservative interval domains. Dependency overestimation may reject valid expressions. */
export function expressionInterval(
  node: PlotExpression,
  environment: Readonly<Record<string, Interval>>,
): IntervalResult {
  if (node.kind === "number") return result(node.value, node.value);
  if (node.kind === "identifier") {
    const value =
      node.name === "pi"
        ? [Math.PI, Math.PI]
        : node.name === "e"
          ? [Math.E, Math.E]
          : environment[node.name];
    return value ? result(value[0]!, value[1]!) : uncertain();
  }
  if (node.kind === "unary") {
    const a = expressionInterval(node.operand, environment);
    return node.operator === "-"
      ? { ...a, range: [-a.range[1], -a.range[0]] }
      : a;
  }
  const args = (
    node.kind === "call" ? node.arguments : [node.left, node.right]
  ).map((arg) => expressionInterval(arg, environment));
  if (args.some((a) => a.state === "undefined")) return invalid();
  if (args.some((a) => a.state !== "safe")) return uncertain();
  const [a, b] = args;
  const [lo, hi] = a!.range;
  let r: IntervalResult;
  if (node.kind === "binary") {
    const [bl, bh] = b!.range;
    switch (node.operator) {
      case "+":
        r = result(lo + bl, hi + bh);
        break;
      case "-":
        r = result(lo - bh, hi - bl);
        break;
      case "*": {
        const v = [lo * bl, lo * bh, hi * bl, hi * bh];
        r = result(Math.min(...v), Math.max(...v));
        break;
      }
      case "/": {
        if (bl === 0 && bh === 0) return invalid();
        if (bl <= 0 && bh >= 0) return uncertain();
        const v = [lo / bl, lo / bh, hi / bl, hi / bh];
        r = result(Math.min(...v), Math.max(...v));
        break;
      }
      case "^": {
        if (bl === bh && Number.isInteger(bl)) {
          if (bl <= 0 && lo <= 0 && hi >= 0) return uncertain();
          const v = [lo ** bl, hi ** bl];
          r = result(
            bl > 0 && bl % 2 === 0 && lo <= 0 && hi >= 0 ? 0 : Math.min(...v),
            Math.max(...v),
          );
        } else {
          if (hi < 0) return invalid();
          if (lo <= 0) return uncertain();
          const v = [lo ** bl, lo ** bh, hi ** bl, hi ** bh];
          r = result(Math.min(...v), Math.max(...v));
        }
        break;
      }
    }
  } else {
    switch (node.name) {
      case "sin":
      case "cos": {
        const offset = node.name === "cos" ? 0 : Math.PI / 2;
        const fn = node.name === "cos" ? Math.cos : Math.sin;
        let min = Math.min(fn(lo), fn(hi)),
          max = Math.max(fn(lo), fn(hi));
        if (hi - lo >= 2 * Math.PI) {
          min = -1;
          max = 1;
        } else {
          for (
            let k = Math.ceil((lo - offset) / Math.PI);
            k <= Math.floor((hi - offset) / Math.PI);
            k++
          ) {
            const v = k % 2 === 0 ? 1 : -1;
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
        }
        r = result(min, max, hi - lo > 0.35);
        break;
      }
      case "tan":
        if (
          Math.ceil((lo - Math.PI / 2) / Math.PI) <=
          Math.floor((hi - Math.PI / 2) / Math.PI)
        )
          return uncertain();
        r = result(Math.tan(lo), Math.tan(hi), hi - lo > 0.35);
        break;
      case "log":
      case "log10":
        if (hi <= 0) return invalid();
        if (lo <= 0) return uncertain();
        r = result(
          node.name === "log" ? Math.log(lo) : Math.log10(lo),
          node.name === "log" ? Math.log(hi) : Math.log10(hi),
        );
        break;
      case "sqrt":
        if (hi < 0) return invalid();
        if (lo < 0) return uncertain();
        r = result(Math.sqrt(lo), Math.sqrt(hi));
        break;
      case "asin":
      case "acos":
        if (hi < -1 || lo > 1) return invalid();
        if (lo < -1 || hi > 1) return uncertain();
        r =
          node.name === "asin"
            ? result(Math.asin(lo), Math.asin(hi))
            : result(Math.acos(hi), Math.acos(lo));
        break;
      case "atan":
        r = result(Math.atan(lo), Math.atan(hi));
        break;
      case "atan2": {
        const [xl, xh] = b!.range;
        if (
          (lo <= 0 && hi >= 0 && xl <= 0) ||
          (xl <= 0 && xh >= 0 && lo <= 0 && hi >= 0)
        )
          return uncertain();
        const v = [
          Math.atan2(lo, xl),
          Math.atan2(lo, xh),
          Math.atan2(hi, xl),
          Math.atan2(hi, xh),
        ];
        r = result(Math.min(...v), Math.max(...v));
        break;
      }
      case "abs":
        r = result(
          lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi)),
          Math.max(Math.abs(lo), Math.abs(hi)),
        );
        break;
      case "exp":
        r = result(Math.exp(lo), Math.exp(hi));
        break;
      default:
        return uncertain();
    }
  }
  return {
    ...r,
    oscillatory: r.oscillatory || args.some((arg) => arg.oscillatory),
  };
}
