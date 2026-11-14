import assert from "node:assert/strict";
import { test } from "node:test";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import { jobTools, validatePlotToolInput } from "../../src/agent/tools/jobs.ts";
import type { PlotInput } from "../../src/core/contracts/jobs.ts";
import { jobStore } from "../../src/store/jobs.ts";

const tool = jobTools({
  chatId: "plot-schema-test",
  jobStore,
  spawn: () => assert.fail("Schema validation must not dispatch jobs"),
}).plot!;
const input: PlotInput = {
  xLabel: "x",
  xScale: "linear",
  xDomain: [-1, 1],
  panels: [
    {
      title: "Identity",
      yLabel: "y",
      yScale: "linear",
      yDomain: [-2, 2],
      curves: [{ label: "y=x", expression: "x" }],
    },
  ],
};

function validate(arguments_: unknown) {
  return validatePlotToolInput(
    validateToolArguments(tool, {
      type: "toolCall",
      id: "plot-schema-call",
      name: "plot",
      arguments: arguments_ as ToolCall["arguments"],
    }),
  );
}

test("serialized plot domains use homogeneous numeric arrays of exactly two entries", () => {
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  for (const domain of [
    schema.properties.xDomain,
    schema.properties.panels.items.properties.yDomain,
    schema.properties.panels.items.properties.curves.items.properties.xDomain,
  ]) {
    assert.deepEqual(domain, {
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 2,
    });
  }
});

test("curve hints validate through Pi and keep provider-compatible domain arrays", () => {
  const valid = structuredClone(input);
  Object.assign(valid.panels[0]!.curves[0]!, {
    xDomain: [-1, 1],
    sampleAt: [0.1234],
  });
  assert.deepEqual(validate(valid), valid);
  for (const options of [
    { xDomain: [0] },
    { xDomain: [0, 1, 2] },
    { sampleAt: ["invalid"] },
    { sampleAt: Array(129).fill(0) },
  ]) {
    const invalid = structuredClone(input);
    Object.assign(invalid.panels[0]!.curves[0]!, options);
    assert.throws(() => validate(invalid), /Validation failed/);
  }
});

test("independent panel domains use the provider-compatible schema and validate as tuples", () => {
  const schema = JSON.parse(JSON.stringify(tool.parameters)).properties.panels
    .items.properties.xDomain;
  assert.deepEqual(schema.items, { type: "number" });
  assert.equal(schema.minItems, 2);
  assert.equal(schema.maxItems, 2);
  const valid = structuredClone(input);
  valid.panels[0]!.xDomain = [-0.1, 0.1];
  assert.deepEqual(validate(valid), valid);
  for (const domain of [[0], [0, 1, 2], ["invalid", 1]]) {
    const invalid = structuredClone(input);
    Object.assign(invalid.panels[0]!, { xDomain: domain });
    assert.throws(() => validate(invalid), /Validation failed/);
  }
});

test("Pi accepts two-number domains and an omitted optional yDomain", () => {
  assert.deepEqual(validate(input), input);
  const withoutYDomain = structuredClone(input);
  delete withoutYDomain.panels[0]!.yDomain;
  assert.deepEqual(validate(withoutYDomain), withoutYDomain);
});

for (const axis of ["x", "y"] as const) {
  test(`Pi rejects invalid ${axis} domain lengths and nonnumeric entries`, () => {
    for (const domain of [[], [0], [0, 1, 2], ["invalid", 1]]) {
      const invalid = structuredClone(input);
      if (axis === "x") Object.assign(invalid, { xDomain: domain });
      else Object.assign(invalid.panels[0]!, { yDomain: domain });
      assert.throws(
        () => validate(invalid),
        /Validation failed for tool "plot"/,
        `${axis}Domain must reject ${JSON.stringify(domain)}`,
      );
    }
  });
}

test("all annotation kinds validate through Pi and crossing brackets stay provider compatible", () => {
  const valid = structuredClone(input);
  valid.panels[0]!.curves[0]!.id = "identity";
  valid.panels[0]!.annotations = [
    { x: 0, y: 0, label: "Legacy" },
    { kind: "point", x: 0, y: 0, label: "Measured" },
    { kind: "note", x: 0, y: 1, label: "Note" },
    { kind: "curve-point", curveId: "identity", x: 0.5, label: "Feature" },
    {
      kind: "level-crossing",
      curveId: "identity",
      level: "0",
      xBracket: [-1, 1],
      label: "Root",
    },
  ];
  assert.deepEqual(validate(valid), valid);
  const branches = JSON.parse(JSON.stringify(tool.parameters)).properties.panels
    .items.properties.annotations.items.anyOf;
  const crossing = branches.find(
    (s: { properties: { kind?: { const: string } } }) =>
      s.properties.kind?.const === "level-crossing",
  );
  assert.deepEqual(crossing.properties.xBracket, {
    type: "array",
    items: { type: "number" },
    minItems: 2,
    maxItems: 2,
  });
  assert.ok(
    branches.every(
      (s: { additionalProperties: boolean }) =>
        s.additionalProperties === false,
    ),
  );
  for (const annotation of [
    { kind: "curve-point", curveId: "identity", x: 0.5, y: 9, label: "Wrong" },
    { kind: "curve-point", x: 0.5, label: "Missing ID" },
    {
      kind: "level-crossing",
      curveId: "identity",
      level: "0",
      xBracket: [0],
      label: "Bad",
    },
    {
      kind: "level-crossing",
      curveId: "identity",
      level: "0",
      label: "Missing bracket",
    },
    { kind: "unrecognized", x: 0, y: 0, label: "Bad" },
  ]) {
    const invalid = structuredClone(input);
    Object.assign(invalid.panels[0]!, { annotations: [annotation] });
    assert.throws(() => validate(invalid), /Validation failed/);
  }
  for (const id of ["", " ", "x".repeat(65)]) {
    const invalid = structuredClone(valid);
    invalid.panels[0]!.curves[0]!.id = id;
    assert.throws(() => validate(invalid), /Validation failed/);
  }
});

test("Pi validates all three 3D branches while rejecting malformed domains and mixed contracts", () => {
  const base = {
    kind: "3d",
    title: "3D",
    xLabel: "x",
    yLabel: "y",
    zLabel: "z",
    xDomain: [-1, 1],
    yDomain: [-1, 1],
    zDomain: [-1, 1],
  };
  const series = [
    { kind: "surface", label: "Plane", expression: "x+y" },
    {
      kind: "parametric",
      label: "Helix",
      xExpression: "cos(u)",
      yExpression: "sin(u)",
      zExpression: "u",
      uDomain: [0, 1],
    },
    { kind: "scatter", label: "Given", points: [{ x: 0, y: 0, z: 0 }] },
  ];
  for (const s of series)
    assert.deepEqual(validate({ ...base, series: [s] }), {
      ...base,
      series: [s],
    });
  for (const bad of [
    { ...base, zDomain: [0], series: [series[0]] },
    { ...base, panels: [], series: [series[0]] },
    {
      ...base,
      series: [{ kind: "scatter", label: "Bad", points: [{ x: 0, y: 0 }] }],
    },
  ])
    assert.throws(() => validate(bad), /Validation failed/);
});

test("provider-facing plot schema exposes both branches as object properties without a root union", () => {
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  assert.equal(schema.type, "object");
  assert.equal(schema.anyOf, undefined);
  assert.ok(
    schema.properties.panels &&
      schema.properties.series &&
      schema.properties.kind,
  );
  assert.deepEqual([...schema.required].sort(), ["xDomain", "xLabel"]);
  assert.throws(
    () => validatePlotToolInput({ kind: "3d", ...input }),
    /Validation failed/,
  );
});

test("plot execute rejects an incomplete 3D branch before creating a job", async () => {
  let lookups = 0;
  const local = jobTools({
    chatId: "invalid-3d",
    jobStore: {
      findJobByToolCallId: async () => {
        lookups++;
        return null;
      },
    } as any,
    spawn: () => assert.fail("Invalid input must not spawn"),
  }).plot!;
  await assert.rejects(
    () =>
      local.execute("invalid-3d", { kind: "3d", xLabel: "x", xDomain: [0, 1] }),
    /Validation failed/,
  );
  assert.equal(lookups, 0);
});
