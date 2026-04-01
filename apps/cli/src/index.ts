import { handleAdminTokenShow } from './commands/admin/token/show.ts';

export type CommandResult = {
  exitCode: number;
  output?: string;
  error?: string;
};

export type CommandHandler = (args: string[]) => Promise<CommandResult>;

const commands: Record<string, CommandHandler> = {
  'admin token show': handleAdminTokenShow,
};

function printHelp(): void {
  console.log(`
OpenAidy CLI - Local administration tool

Usage:
  openaidy <command> [args]

Commands:
  admin token show    Show the current bootstrap-admin token information

Options:
  -h, --help          Show this help message

Examples:
  pnpm openaidy admin token show
`);
}

export async function runCli(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    process.exit(0);
  }

  // Try to match the longest command first
  const commandKeys = Object.keys(commands).sort((a, b) => b.split(' ').length - a.split(' ').length);
  
  for (const key of commandKeys) {
    const parts = key.split(' ');
    const matches = parts.every((part, i) => argv[i] === part);
    
    if (matches) {
      const args = argv.slice(parts.length);
      const result = await commands[key](args);
      
      if (result.output) {
        console.log(result.output);
      }
      if (result.error) {
        console.error(result.error);
      }
      
      process.exit(result.exitCode);
    }
  }

  console.error(`Unknown command: ${argv.join(' ')}`);
  console.error('Run "openaidy --help" for usage information.');
  process.exit(1);
}

export { handleAdminTokenShow };
