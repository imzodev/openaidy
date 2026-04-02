#!/usr/bin/env node
import { runCli } from '../src/index.js';

runCli(process.argv.slice(2))
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
