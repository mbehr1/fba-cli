/**
 * todos:
 * [] add glob support for files passed as arguments
 */

import chalk from 'chalk'

const error = chalk.bold.red
const warning = chalk.bold.yellow

export const cmdExec = (files: string[], options: any) => {
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
    return
  }
}
