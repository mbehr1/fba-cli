/**
 * todos:
 * [] add glob support for files passed as arguments
 */

import chalk from 'chalk'
import { MultiBar } from 'cli-progress'

const error = chalk.bold.red
const warning = chalk.bold.yellow

export const cmdExec = async (files: string[], options: any) => {
  console.log('cmdExec', files, options)

  const fbaFiles: string[] = []
  const nonFbaFiles: string[] = []

  for (const file of files) {
    // check whether file exists otherwise apply glob pattern first todo

    if (file.endsWith('.fba')) {
      fbaFiles.push(file)
    } else {
      nonFbaFiles.push(file)
    }
  }
  console.log('exec: fba files:', fbaFiles)
  console.log('exec: non fba files:', nonFbaFiles)

  if (fbaFiles.length === 0) {
    console.log(warning('no fba files found!'))
    if (nonFbaFiles.length > 0) {
      console.log(warning(`Dont' know what to do with the other ${nonFbaFiles.length} files!`))
    }
  } else {
    console.log('exec: processing...')
    const multibar = new MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: ' {bar} | {percentage}% | {value}/{total} | {file}',
    })
    const barAdlt = multibar.create(1, 0, { file: 'starting adlt' })
    const barMsgsLoadedOptions = {
      format: ' {bar} | {percentage}% | {duration}s/{eta}s | msgs processed',
    }
    const barMsgsLoaded = multibar.create(100, 0, {}, barMsgsLoadedOptions)
    const barFbas = multibar.create(fbaFiles.length, 0)
    // start adlt
    multibar.log(`Starting adlt...\n`)
    // wait 5s
    await new Promise((resolve) => setTimeout(resolve, 5000))
    barAdlt.increment(1, { file: 'adlt started' })
    // load dlt files
    multibar.log(`Processing DLT files...\n`)
    // exec the fba files
    for (const fbaFile of fbaFiles) {
      barFbas.increment(1, { file: fbaFile })
      // console.log(`executing fba file:'${fbaFile}'`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    multibar.stop()
  }
}
