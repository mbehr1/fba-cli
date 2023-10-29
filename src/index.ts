#! /usr/bin/env node

/**
 * todos:
 */

import { Command } from 'commander'
import { version } from './util.js'
import { cmdExec } from './cmdExec.js'

try {
  const program = new Command()

  program
    .name('fba-cli')
    .version(version())
    .description('A CLI (command line interface) to execute FBA (fishbone analysis) files with DLT-logs/adlt')
    .showHelpAfterError()

  program // todo or move to cmdExec?
    .command('exec')
    .description('execute FBA files with DLT-logs')
    .option('-c, --config <config>', 'json config file with object key dlt-logs.plugins')
    // .option('-j, --junit <output>', 'junit output filename ')
    .argument('<files...>', 'FBA and DLT files to be processed')
    .action(cmdExec)

  program.parse()
  const options = program.opts()

  // console.log('options:', options)
} catch (e) {
  console.error(`got error:${e}`)
}
