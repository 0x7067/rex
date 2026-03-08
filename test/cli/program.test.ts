import { describe, expect, it } from "vitest";
import { createProgram } from "../../src/cli/program.js";

describe("createProgram", () => {
  it("registers only the supported public rollout commands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((command) => command.name());

    expect(commandNames).toEqual([
      "connect",
      "add",
      "remove",
      "resources",
      "sync",
      "ask",
    ]);
  });
});
