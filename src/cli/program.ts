import { Command } from "commander";
import { registerConnect } from "./connect.js";
import { registerAdd } from "./add.js";
import { registerRemove } from "./remove.js";
import { registerResources } from "./resources.js";
import { registerSync } from "./sync.js";
import { registerAsk } from "./ask.js";
import { getCliVersion } from "../version.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rex")
    .description("rex: resource-first persistent knowledge CLI")
    .version(getCliVersion())
    .option("--json", "Output machine-readable JSON")
    .addHelpCommand(true);

  registerConnect(program);
  registerAdd(program);
  registerRemove(program);
  registerResources(program);
  registerSync(program);
  registerAsk(program);

  return program;
}
