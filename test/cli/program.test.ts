import { describe, expect, it, vi } from "vitest";
import { createProgram, runCli } from "../../src/cli/program.js";

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

  it("prints concise quick-start help when no command is provided", async () => {
    let output = "";
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        output += String(chunk);
        return true;
      }) as typeof process.stdout.write);

    await runCli(["node", "rex"]);

    expect(output).toContain("Start here:");
    expect(output).toContain("rex connect claude");
    expect(output).toContain('rex ask "How does the sync pipeline work?"');
    expect(output).toContain("Run `rex --help` for the full command reference.");

    writeSpy.mockRestore();
  });

  it("includes examples without project URLs in top-level help", () => {
    const program = createProgram();
    let output = "";
    program.configureOutput({
      writeOut: (str) => {
        output += str;
      },
      writeErr: () => {},
    });

    program.outputHelp();

    expect(output).toContain("Examples:");
    expect(output).toContain("rex connect claude");
    expect(output).toContain("rex add ./some-project");
    expect(output).not.toContain("Docs:");
    expect(output).not.toContain("Issues:");
  });
});
