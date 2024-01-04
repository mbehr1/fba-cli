#! /usr/bin/env node

/**
 * todos:
 */

import { Command } from 'commander'
import { version } from './util.js'
import { cmdExec } from './cmdExec.js'
import { cmdExport } from './cmdExport.js'

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
    .option('-p, --port <port>', 'adlt remote host:port e.g. 127.0.0.1:7777. Otherwise an adlt if in path will be started locally.')
    // .option('-j, --junit <output>', 'junit output filename ')
    .argument('<files...>', 'FBA and DLT files to be processed')
    .action(cmdExec)

  program
    .command('export')
    .description('export info from FBA files')
    .requiredOption('-f, --format <type>', 'format to export: currently only "dlt-viewer" for filters in dlt-viewer xml format')
    .argument('<fbaFile>', 'FBA file where to export from')
    .argument('<zipFile>', 'output zip file path. Existing ones will be overwritten!')
    .action(cmdExport)

  program.parse()
  const options = program.opts()

  // console.log('options:', options)
} catch (e) {
  console.error(`got error:${e}`)
}
