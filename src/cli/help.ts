import type { Command } from "commander";

export function addExamples(command: Command, examples: string[]): Command {
  if (examples.length === 0) return command;

  return command.addHelpText(
    "before",
    ["Examples:", ...examples.map((example) => `  ${example}`), ""].join("\n"),
  );
}

export function joinLines(lines: Array<string | false | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}
