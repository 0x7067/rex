import { describe, expect, it } from "vitest";
import { findCallers, findCallees } from "../../src/analysis/callgraph.js";
import type { RetrievedChunk } from "../../src/query/retriever.js";

function makeChunk(overrides: Partial<RetrievedChunk> & { text: string }): RetrievedChunk {
  return {
    resource_id: "r1",
    resource_name: "my-project",
    file_path: "src/index.ts",
    chunk_index: 0,
    start_line: 1,
    end_line: 20,
    score: 0.1,
    ...overrides,
  };
}

describe("findCallers", () => {
  it("detects direct function calls", () => {
    const chunk = makeChunk({
      start_line: 10,
      text: "const result = myFunc(arg1, arg2);",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(10);
    expect(hits[0]!.context).toBe("const result = myFunc(arg1, arg2);");
    expect(hits[0]!.kind).toBe("call");
  });

  it("detects method calls (obj.symbol())", () => {
    const chunk = makeChunk({
      start_line: 5,
      text: "await this.retrieve(query, ids);",
    });
    const hits = findCallers("retrieve", [chunk]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(5);
    expect(hits[0]!.kind).toBe("call");
  });

  it("detects import references", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: 'import { retrieve } from "../query/retriever.js";',
    });
    const hits = findCallers("retrieve", [chunk]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("import");
  });

  it("excludes definition lines (function declaration)", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: "function myFunc(x: string) {\n  return x;\n}",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(0);
  });

  it("excludes definition lines (const arrow function)", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: "const myFunc = (x: string) => x;",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(0);
  });

  it("computes line numbers from chunk.start_line + offset within text", () => {
    const chunk = makeChunk({
      start_line: 100,
      text: "const a = 1;\nconst b = 2;\nconst result = myFunc();",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(1);
    // Line 100 is "const a = 1;", line 101 is "const b = 2;", line 102 is call
    expect(hits[0]!.line).toBe(102);
  });

  it("handles NaN start_line by using 0 as base", () => {
    const chunk = makeChunk({
      start_line: NaN,
      text: "const result = myFunc();",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(0);
  });

  it("detects multiple calls across lines", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: "myFunc(a);\nother();\nmyFunc(b);",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.line).toBe(1);
    expect(hits[1]!.line).toBe(3);
  });

  it("does not match partial identifiers (myFuncExtra is not myFunc)", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: "myFuncExtra(args);",
    });
    const hits = findCallers("myFunc", [chunk]);
    expect(hits).toHaveLength(0);
  });

  it("finds callers across multiple chunks", () => {
    const chunk1 = makeChunk({
      file_path: "src/a.ts",
      start_line: 10,
      text: "myFunc(x);",
    });
    const chunk2 = makeChunk({
      file_path: "src/b.ts",
      start_line: 20,
      text: "myFunc(y);",
    });
    const hits = findCallers("myFunc", [chunk1, chunk2]);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.file_path).toBe("src/a.ts");
    expect(hits[1]!.file_path).toBe("src/b.ts");
  });
});

describe("findCallees", () => {
  it("extracts function calls from function body", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: [
        "function doWork(input: string) {",
        "  const result = parse(input);",
        "  return format(result);",
        "}",
      ].join("\n"),
    });
    const hits = findCallees("doWork", [chunk]);
    const calleeNames = hits.map((h) => h.context);
    expect(calleeNames.some((c) => c.includes("parse("))).toBe(true);
    expect(calleeNames.some((c) => c.includes("format("))).toBe(true);
  });

  it("filters out JS/TS keywords", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: [
        "function process(items: string[]) {",
        "  if (items.length > 0) {",
        "    for (const item of items) {",
        "      return transform(item);",
        "    }",
        "  }",
        "}",
      ].join("\n"),
    });
    const hits = findCallees("process", [chunk]);
    const calleeNames = hits.map((h) => {
      const match = /\b([a-zA-Z_$][\w$]*)\s*\(/.exec(h.context);
      return match?.[1];
    });
    // keywords should be filtered out
    expect(calleeNames).not.toContain("if");
    expect(calleeNames).not.toContain("for");
    expect(calleeNames).not.toContain("return");
    // transform should be included
    expect(calleeNames.some((n) => n === "transform")).toBe(true);
  });

  it("returns empty when symbol definition not found in chunk", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: "otherFunc(a, b);",
    });
    const hits = findCallees("myFunc", [chunk]);
    expect(hits).toHaveLength(0);
  });

  it("computes line numbers from chunk.start_line + offset", () => {
    const chunk = makeChunk({
      start_line: 50,
      text: [
        "function myFunc() {",
        "  const a = helper();",
      ].join("\n"),
    });
    const hits = findCallees("myFunc", [chunk]);
    expect(hits).toHaveLength(1);
    // def is line 50 (offset 0), body starts at offset 1 → line 51
    expect(hits[0]!.line).toBe(51);
  });

  it("deduplicates callees by name (each unique callee appears once)", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: [
        "function doStuff() {",
        "  helper(a);",
        "  helper(b);",
        "  other();",
        "}",
      ].join("\n"),
    });
    const hits = findCallees("doStuff", [chunk]);
    const contexts = hits.map((h) => h.context);
    // helper should appear only once due to dedup
    const helperHits = contexts.filter((c) => c.includes("helper("));
    expect(helperHits).toHaveLength(1);
    // other should appear once
    const otherHits = contexts.filter((c) => c.includes("other("));
    expect(otherHits).toHaveLength(1);
  });

  it("handles const arrow function definitions", () => {
    const chunk = makeChunk({
      start_line: 1,
      text: [
        "const myFunc = (x: string) => {",
        "  return transform(x);",
        "};",
      ].join("\n"),
    });
    const hits = findCallees("myFunc", [chunk]);
    expect(hits.some((h) => h.context.includes("transform("))).toBe(true);
  });
});
