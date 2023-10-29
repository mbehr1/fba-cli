/**
 * todos:
 * [] add lifecycle summary/table to report
 * [] add glob support for files passed as arguments
 * [] add option to include matching messages in a collaspable section
 * [] support markdown description from fba instructions and backgroundDescription
 * [] add support for reports (either as html embedded or as non interactive pngs)
 * [] support junit xml output format
 */
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

import { default as JSON5 } from 'json5'
import { default as jp } from 'jsonpath'

import chalk from 'chalk'
import { MultiBar } from 'cli-progress'
import { AdltRemoteClient, FileBasedMsgsHandler, MsgType, char4U32LeToString, getAdltProcessAndPort } from './adltRemoteClient.js'
import { FBBadge, FBCategory, FBEffect, Fishbone, getFBDataFromText, rqUriDecode } from './fbaFormat.js'
import {
  FbCategoryResult,
  FbEffectResult,
  FbRootCauseResult,
  FbaExecReport,
  FbaResult,
  fbReportToMdast,
  hideBadge2Value,
  hideBadgeValue,
} from './execReport.js'
import { Node } from 'unist'
import { inspect } from 'unist-util-inspect'
import { filter } from 'unist-util-filter'
import { assert as mdassert } from 'mdast-util-assert'
import { toMarkdown } from 'mdast-util-to-markdown'
import { ChildProcess } from 'child_process'
import path from 'path'
import { sleep } from './util.js'

const error = chalk.bold.red
const warning = chalk.bold.yellow

export const cmdExec = async (files: string[], options: any) => {
  // console.log('cmdExec', files, options)

  const fbaFiles: string[] = []
  const nonFbaFiles: string[] = []

  // load json config?
  let pluginCfgs: string = JSON.stringify([])
  if (options.config) {
    try {
      const config = JSON5.parse(fs.readFileSync(options.config, 'utf-8'))
      const plugins = config['dlt-logs.plugins']
      if (plugins && Array.isArray(plugins)) {
        pluginCfgs = JSON.stringify(config['dlt-logs.plugins'])
      } else {
        console.log(error(`No 'dlt-logs.plugins' config array in config file '${options.config}'!`))
        return
      }
    } catch (e) {
      console.log(error(`failed to load config file '${options.config}'! Got error:${e}`))
      return
    }
  }

  const sortOrderByTime = 'sortOrderByTime' in options ? !!options.sortOrderByTime : true

  for (const file of files) {
    // check whether file exists otherwise apply glob pattern first todo

    if (file.endsWith('.fba')) {
      fbaFiles.push(file)
    } else {
      nonFbaFiles.push(file)
    }
  }
  // console.log('exec: fba files:', fbaFiles)
  // console.log('exec: non fba files:', nonFbaFiles)

  if (fbaFiles.length === 0) {
    console.log(warning('no fba files found!'))
    if (nonFbaFiles.length > 0) {
      console.log(warning(`Dont' know what to do with the other ${nonFbaFiles.length} files!`))
    }
  } else {
    //console.log('exec: processing...')
    const multibar = new MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: ' {bar} | {percentage}% | {value}/{total} | {file}',
    })
    const barAdlt = multibar.create(5, 0, { file: 'starting adlt' })
    const barMsgsLoadedOptions = {
      format: '                                       {duration}s | {total} msgs read',
    }
    const barMsgsLoaded = multibar.create(0, 0, {}, barMsgsLoadedOptions)
    const barFbas = multibar.create(fbaFiles.length, 0)
    const barQueries = multibar.create(0, 0, { file: 'queries' })

    const fileBasedMsgsHandler: FileBasedMsgsHandler = (msg: MsgType) => {
      try {
        switch (msg.tag) {
          case 'FileInfo':
            const fi = msg.value
            barMsgsLoaded.setTotal(fi.nr_msgs)
            break
          case 'Lifecycles':
            const li = msg.value
            //multibar.log(`Got ${li.length} lifecycles ${char4U32LeToString(li[0]?.ecu || 0)}\n`)
            break
        }
      } catch (e) {
        console.warn(`fileBasedMsgsHandler got error:${e}\n`)
      }
    }

    const adltClient = new AdltRemoteClient(fileBasedMsgsHandler)
    // start adlt
    multibar.log(`Starting/connecting to adlt...\n`)

    let adltWssPort: string | undefined
    let adltProcess: ChildProcess | undefined
    if (options.port) {
      adltWssPort = options.port
    } else {
      // try to start adlt locally and set the port variable:
      // todo for now output to tmpdir file (for later provide better solution)
      const adltOut = path.join(os.tmpdir(), `fba-cli.adlt-out.${crypto.randomBytes(16).toString('hex')}.txt`)
      multibar.log(`adlt console output file:'${adltOut}'\n`)
      //console.error(`tmpDir=${adltOut}`)
      await getAdltProcessAndPort('adlt', fs.createWriteStream(adltOut /*os.devNull*/)).then(
        ({ hostAndPort, process }) => {
          adltWssPort = hostAndPort
          adltProcess = process
        },
        (e) => {
          console.log(error(`Failed to start adlt! Got error:${e}`))
        },
      )
    }

    if (!adltWssPort) {
      multibar.stop()
      console.log(
        error(
          `No adlt remote host:port to use! Please ensure that adlt is running and provide the port via the -p option or have adlt in path and don't provide the -p option!`,
        ),
      )
      return
    }

    let report: FbaExecReport | undefined

    // todo add parameter!
    barAdlt.increment(1, { file: 'adlt connecting' })
    adltClient
      .connectToWebSocket(`ws://${adltWssPort}`)
      .then(async (adltVersion) => {
        //multibar.log(`Connected to adlt...\n`)
        barAdlt.increment(1, { file: 'adlt connected' })
        // open files
        await adltClient
          .sendAndRecvAdltMsg(`open {"sort":${sortOrderByTime},"files":${JSON.stringify(nonFbaFiles)},"plugins":${pluginCfgs}}`)
          .then(async (response) => {
            report = {
              type: 'FbaExecReport',
              data: {
                date: new Date().toISOString(),
                adltVersion,
                files: nonFbaFiles,
                pluginCfgs,
              },
              children: [],
            }
            // todo check response
            // multibar.log(`Opened files...\n`)
            barAdlt.increment(1, { file: 'adlt files opened' })
            // load dlt files
            multibar.log(`Processing DLT files...\n`)
            // todo currently adlt doesn't indicate once it finished loading the files.
            // so for now we do wait 2s until the msg.total don't change any more
            let lastTotal = barAdlt.getTotal()
            for (let i = 0; i < 1000; i++) {
              await sleep(2000)
              const curTotal = barAdlt.getTotal()
              if (lastTotal === curTotal) {
                break
              } else {
                lastTotal = curTotal
              }
            }
            multibar.log(`Processing fba files...\n`)
            // exec the fba files
            for (const fbaFile of fbaFiles) {
              const fbaResult: FbaResult = {
                type: 'FbaResult',
                data: {
                  fbaFileName: fbaFile,
                  errors: [],
                },
                children: [],
              }
              report.children.push(fbaResult)
              barFbas.increment(1, { file: fbaFile })
              // console.log(`executing fba file:'${fbaFile}'`)
              await processFbaFile(fbaFile, fbaResult, adltClient).then(
                async function (promises): Promise<void> {
                  //barFbas.increment(nrOfFbas)
                  barQueries.setTotal(barQueries.getTotal() + promises.length)
                  await Promise.allSettled(promises).then((results) => {
                    barQueries.increment(results.length)
                  })
                },
                (e): void => {
                  multibar.log(error(`Failed to process fba file:'${fbaFile}'! Got error:${e}`))
                },
              )
            }
          })
          .catch((e) => {
            console.log(error(`Failed to open DLT files! Got error:${e}`))
          })
      })
      .catch((e) => {
        console.log(error(`Failed to connect to adlt! Got error:${e}`))
      })
      .finally(() => {
        multibar.stop()
        adltClient.close()
        if (adltProcess) {
          try {
            adltProcess.kill()
          } catch (e) {
            console.log(error(`Failed to kill adlt process! Got error:${e}`))
          }
        }
        if (report) {
          //console.log(JSON.stringify(report, null, 2)) // use unist-util-inspect
          // console.log(`report is=${is(report, 'FbaExecReport')}`)
          // filter all value.badge = Number(0)
          report = filter(report, (node: Node) => {
            return (
              node.type !== 'FbRootCauseResult' ||
              !hideBadgeValue((node as FbRootCauseResult).value.badge) ||
              !hideBadge2Value((node as FbRootCauseResult).value.badge2)
            )
          })
          if (report) {
            // convert by default to md/markdown
            const reportAsMd = fbReportToMdast(report)
            try {
              mdassert(reportAsMd)
              console.log(toMarkdown(reportAsMd))
            } catch (e) {
              console.log(inspect(reportAsMd))
              console.warn(`reportAsMd got error:${e}`)
            }
          }
        } else {
          console.log(warning('failed to generate a report!'))
        }
      })
  }
}

function objectMember<T>(obj: any, key: string): { value: T } {
  return {
    get value(): T {
      return obj[key]
    },
    set value(t: T) {
      obj[key] = t
    },
  }
}

const processBadge = async (badge: FBBadge, adltClient: AdltRemoteClient, rcResult: { value: string | number | undefined }) => {
  try {
    if (badge.conv && badge.source.startsWith('ext:mbehr1.dlt-logs/')) {
      const rq = rqUriDecode(badge.source)
      // console.log(`rqCmd.path=${rqCmd.path}`)
      if (rq.path.endsWith('/filters?')) {
        //console.log(`rq.commands=${JSON.stringify(rq.commands)}`)
        for (const cmd of rq.commands) {
          rcResult.value = undefined
          if (cmd.cmd === 'query') {
            // todo what if multiple queries?
            const conv = badge.conv
            await adltClient.getMatchingMessages(JSON5.parse(cmd.param), 1000).then((msgs) => {
              try {
                // jsonPath expects restQuery results as:
                // {data: [{id, type, attributes: {timeStamp, ecu, mcnt, ctid, apid, mtin, payloadString, lifecycle}}]}
                const rqResult = {
                  data: msgs.map((msg, idx) => msg.asRestObject(idx)),
                }
                // console.log(`got ${msgs.length} msgs. jsonPath=${badge.jsonPath}\n`)
                const jsonPath = badge.jsonPath
                let jsonPathResult: any[] | undefined
                if (jsonPath) {
                  jsonPathResult = jp.query(rqResult, jsonPath)
                  //console.log(`jsonPathResult.length=${jsonPathResult.length}`)
                }
                const result = jsonPathResult !== undefined ? jsonPathResult : rqResult
                const indexFirstC = conv.indexOf(':')
                const convType = conv.slice(0, indexFirstC)
                const convParam = conv.slice(indexFirstC + 1)
                let convResult: string | number | undefined
                switch (convType) {
                  case 'length':
                    convResult = Array.isArray(result) ? result.length : Array.isArray(result.data) ? result.data.length : 0
                    break
                  case 'index':
                    convResult =
                      Array.isArray(result) && result.length > Number(convParam)
                        ? typeof result[Number(convParam)] === 'string'
                          ? result[Number(convParam)]
                          : JSON.stringify(result[Number(convParam)])
                        : 0
                    break
                  case 'func':
                    try {
                      if (!(globalThis as any).JSON5) {
                        ;(globalThis as any).JSON5 = JSON5
                      }
                      const fn = Function('result', convParam)
                      const fnRes = fn(result)
                      switch (typeof fnRes) {
                        case 'string':
                        case 'number':
                          convResult = fnRes
                          break
                        case 'object':
                          convResult = JSON.stringify(fnRes)
                          break
                        case 'undefined':
                          break
                        default:
                          convResult = `unknown result type '${typeof fnRes}'. Please return string or number`
                          break
                      }
                    } catch (e) {
                      console.warn(`processBadg.msgs func got error:${e}`)
                    }
                    break
                  default:
                    break
                }
                if (rcResult.value !== undefined) {
                  rcResult.value = rcResult.value.toString() + (convResult !== undefined ? convResult.toString() : '<undefined>')
                } else {
                  rcResult.value = convResult
                }
              } catch (e) {
                console.warn(`processBadge.msgs got error:${e}`)
                rcResult.value += `processBadge.msgs got error:${e}`
              }
            })
          } else {
            console.log(`rq.cmd=${cmd} ignored!`)
            rcResult.value = '<none>'
          }
        }
      } else {
        rcResult.value = '<no /filters>'
      }
    } else {
      // silently skip/ignore rcResult.value = '<no ext:mbehr1.dlt-logs/>'
      rcResult.value = undefined
    }
  } catch (e) {
    console.warn(`processBadge got error:${e}`)
    rcResult.value = `processBadge got error:${e}`
  }
}

function iterateFbEffects(fishbone: FBEffect[], fbaResult: FbaResult, adltClient: AdltRemoteClient) {
  const promises: Promise<void>[] = []
  for (const effect of fishbone) {
    const effectResult: FbEffectResult = {
      type: 'FbEffectResult',
      data: { ...effect },
      children: [],
    }
    delete effectResult.data.categories
    delete effectResult.data.fbUid

    if (effect?.categories?.length) {
      for (const category of effect.categories) {
        const categoryResult: FbCategoryResult = {
          type: 'FbCategoryResult',
          data: { ...category },
          children: [],
        }
        delete categoryResult.data.rootCauses
        delete categoryResult.data.fbUid

        if (category?.rootCauses?.length) {
          for (const rc of category.rootCauses) {
            //console.log(`fbType=${fbType}, fbElement.type=${fbElement.type},fbElement.element=${fbElement.element} parent=${parent.name}`)
            if (rc.props?.badge || rc.props?.badge2) {
              const rcResult: FbRootCauseResult = {
                type: 'FbRootCauseResult',
                data: {
                  ...rc,
                  name: rc.props.label,
                  backgroundDescription: rc.props.backgroundDescription,
                  instructions: rc.props.instructions,
                },
                value: {
                  badge: rc.props.badge ? '<pending>' : undefined,
                  badge2: rc.props.badge2 ? '<pending>' : undefined,
                },
              }
              delete rcResult.data.type
              delete rcResult.data.element
              delete rcResult.data.fbUid
              delete rcResult.data.data
              delete rcResult.data.props

              categoryResult.children.push(rcResult)
              if (rc.props.badge) {
                promises.push(processBadge(rc.props.badge, adltClient, objectMember(rcResult.value, 'badge')))
              }
              if (rc.props.badge2) {
                promises.push(processBadge(rc.props.badge2, adltClient, objectMember(rcResult.value, 'badge2')))
              }
            }
            if (rc.type === 'nested' && Array.isArray(rc.data)) {
              const nestedResult: FbaResult = {
                type: 'FbaResult',
                data: {
                  fbaTitle: rc.title,
                  errors: [],
                },
                children: [],
              }
              promises.push(...iterateFbEffects(rc.data, nestedResult, adltClient))
              if (nestedResult.children.length) {
                categoryResult.children.push(nestedResult)
              }
            }
          }
        }
        if (categoryResult.children.length) {
          effectResult.children.push(categoryResult)
        }
      }
    }
    if (effectResult.children.length) {
      fbaResult.children.push(effectResult)
    }
  }
  return promises
}

const processFbaFile = async (filePath: string, fbaResult: FbaResult, adltClient: AdltRemoteClient): Promise<Promise<void>[]> => {
  // try to open the file:
  return new Promise<Promise<void>[]>((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, fbaFileContent) => {
      if (err) {
        // console.log(error(`Failed to read fba file:'${filePath}'! Got error:${err}`))
        fbaResult.data.errors.push(`Failed to read fba file due to: ${err}`)
        reject(err)
        return
      }
      try {
        const fba = getFBDataFromText(fbaFileContent)
        fbaResult.data.fbaTitle = fba.title
        const promises = iterateFbEffects(fba.fishbone, fbaResult, adltClient)
        resolve(promises)
      } catch (e) {
        fbaResult.data.errors.push(`Processing fba got error: ${e}`)
        reject(e)
      }
    })
  })
}
