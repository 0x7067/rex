import { Command } from "commander";
import { registerConnect } from "./connect.js";
import { registerAdd } from "./add.js";
import { registerRemove } from "./remove.js";
import { registerResources } from "./resources.js";
import { registerSync } from "./sync.js";
import { registerAsk } from "./ask.js";
import { getCliVersion } from "../version.js";

const REPO_URL = "https://github.com/Denguinho/rex";
const ISSUES_URL = "https://github.com/Denguinho/rex/issues";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rex")
    .description("rex: resource-first persistent knowledge CLI")
    .version(getCliVersion())
    .option("--json", "Output machine-readable JSON")
    .showHelpAfterError("Run `rex --help` for the full command reference.")
    .showSuggestionAfterError(true)
    .addHelpCommand(true)
    .addHelpText("before", renderTopLevelHelpIntro());

  registerConnect(program);
  registerAdd(program);
  registerRemove(program);
  registerResources(program);
  registerSync(program);
  registerAsk(program);

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  if (argv.length <= 2) {
    process.stdout.write(`${renderQuickStartHelp()}\n`);
    return;
  }

  await createProgram().parseAsync(argv);
}

function renderTopLevelHelpIntro(): string {
  return joinParagraphs([
    "Start here:",
    "  rex connect claude",
    "  rex add ./some-project",
    '  rex ask "How does the sync pipeline work?"',
    "",
    "Core commands:",
    "  connect     Configure the active answer provider",
    "  add         Add a resource and index it",
    "  resources   See what rex already knows",
    "  sync        Refresh saved resources",
    "  ask         Ask a grounded question",
    "",
    "Examples:",
    "  rex connect claude",
    "  rex add ./some-project",
    '  rex ask "How does the sync pipeline work?"',
    "",
    `Docs: ${REPO_URL}`,
    `Issues: ${ISSUES_URL}`,
  ]);
}

function renderQuickStartHelp(): string {
  return joinParagraphs([
    "rex: resource-first persistent knowledge CLI",
    "",
    "Start here:",
    "  rex connect claude",
    "  rex add ./some-project",
    '  rex ask "How does the sync pipeline work?"',
    "",
    "Common commands:",
    "  rex resources",
    "  rex sync",
    "  rex remove some-project",
    "",
    "Run `rex --help` for the full command reference.",
  ]);
}

function joinParagraphs(lines: string[]): string {
  return lines.join("\n");
}
