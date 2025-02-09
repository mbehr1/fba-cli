import { readFileSync } from 'fs'

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
