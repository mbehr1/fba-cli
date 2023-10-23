/**
 * todos:
 * [] add glob support for files passed as arguments
 */

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

    console.log('exec: fba files:', fbaFiles)
    console.log('exec: non fba files:', nonFbaFiles)
  }
}
