#!/usr/bin/env node
import { Command } from "commander";
import { registerConnect } from "../src/cli/connect.js";
import { registerAdd } from "../src/cli/add.js";
import { registerRemove } from "../src/cli/remove.js";
import { registerResources } from "../src/cli/resources.js";
import { registerSync } from "../src/cli/sync.js";
import { registerAsk } from "../src/cli/ask.js";
import { registerSearch } from "../src/cli/search.js";
import { registerWatch } from "../src/cli/watch.js";

const program = new Command();

program
  .name("rex")
  .description("rex: resource-first persistent knowledge CLI")
  .version("0.1.0")
  .option("--json", "Output machine-readable JSON")
  .addHelpCommand(true);

registerConnect(program);
registerAdd(program);
registerRemove(program);
registerResources(program);
registerSync(program);
registerAsk(program);
registerSearch(program);
registerWatch(program);

program.parse(process.argv);
