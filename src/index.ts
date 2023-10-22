#! /usr/bin/env node

import { Command } from 'commander';

const program = new Command();
program
  .version('1.0.0')
  .description('A CLI (command line interface) to execute FBA (fishbone analysis) files with DLT-logs/adlt')
  .parse(process.argv);

const options = program.opts();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
