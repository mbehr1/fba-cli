import { readFileSync, existsSync, lstatSync } from 'fs'
import {globSync} from 'glob'

let cachedVersion: string | undefined

export function version(): string {
  // read version from package.json
  if (cachedVersion === undefined) {
    let json // : any | undefined
    try {
      // we're called from dist or src
      json = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    } catch (e) {
      // during jest test this is expected... (all quite messy)
      console.log(`version() readFileSync failed: ${e}`)
    }
    try {
      const pkg = JSON.parse(json || '')
      cachedVersion = pkg.version
    } catch {
      cachedVersion = 'unknown'
    }
  }
  return cachedVersion || 'unknown'
}

// taken from https://stackoverflow.com/questions/38213668/promise-retry-design-patterns
// slightly adapted to TS

export function retryOperation<T>(operation: (retries_left: number) => Promise<T>, delay: number, retries: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    return operation(retries)
      .then(resolve)
      .catch((reason) => {
        if (retries > 0) {
          return sleep(delay)
            .then(retryOperation.bind(null, operation, delay, retries - 1))
            .then((value) => resolve(value as T))
            .catch(reject)
        }
        return reject(reason)
      })
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function containsRegexChars(text: string): boolean {
  // eslint-disable-next-line no-useless-escape
  return text.match(/[\^\$\*\+\?\(\)\[\]\{\}\|\.\-\\\=\!\<\>\,]/g) !== null
}

/**
 * glob support understanding the adlt zip file syntax
 * 
 *  we take care about the zip file globbing supported by adlt:
 * 
 *    1. foo.zip/...
 *    0. foo.zip!/...
 * 
 * so we check:
 * 1. does the file exist -> keep it
 * 2. does it contain !/ -> split it and check whether the first part exists
 * 3. does it contain / -> split it and check whether the first part is a file -> if a file -> keep it
 * @param filename
 * @returns - list of filenames after globbing. If the filename exists itself, it is returned as the single entry.
 */

export function globAdltAlike(filename: string): string[] {
  // check if the file exists
  if (existsSync(filename)) {
    return [filename]
  }
  // file does not exist
  // check if it contains !/
  const idx = filename.indexOf('!/')
  if (idx > 0) {
    const firstPart = filename.substring(0, idx)
    if (existsSync(firstPart)) {
      return [filename]
    }
  }
  // check if it contains /
  const fileParts = filename.split('/')
  if (fileParts.length>1) {
    // check whether the parts are dirs or a file
    let dirParts =''
    for (let i = 0; i < fileParts.length - 1; i++) {
      const part = fileParts[i]
      if (part === '') {
        dirParts += '/'
        continue // skip empty parts
      }
      const partialFilename = dirParts + part
      // console.log(`globAdltAlike: checking '${partialFilename}' of '${filename}'`)
      if (existsSync(partialFilename)) {
        // if it is a dir, we can continue
        const lstat = lstatSync(partialFilename)
        if (lstat.isDirectory()) {
          // add the dir to the dirParts
          dirParts = partialFilename + '/'
          continue
        }
        if (lstat.isFile()) {
        // its a file so return full filename
          return [filename]
        }
      } else {
        break // need to glob it
      }
    }
  }
  // return result from glob:
  const globResult = globSync(filename,{nodir:true}) // options: windowsPathsNoEscape?
  // console.log(`globAdltAlike: globbing '${filename}' -> ${globResult.length} entries`)
  return globResult
}
