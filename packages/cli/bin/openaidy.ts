#!/usr/bin/env node
import { runCli } from '../src/index.ts';

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
