/**
 * todos:
 * [x] load all fba filters upfront and then stream adlt only so that no memory is kept
 * [x] sequence support
 * [ ] seq: add lifecycle check support
 * [x] seq: refactor so that a single message can fail the current one and start a new one
 * [x] (done by isFinished = last mandatory step) seq: add order support (e.g. 2,3,1 should fail (and create a new one with 1))
 * [x] seq: add order support (e.g. 2,1,2 should fail (and create a new one with 1,2))
 * [x] (done by isFinished = last mandatory step seq: check about partial sequences (e.g. 3 steps, 2,3, 1,2,3 <- should lead to a partial seq and a new one)
 * [ ] seq: add support for non sequential filters as well (so arrays of filters)
 * [ ] add glob support for files passed as arguments
 * [ ] add option to include matching messages in a collapsable section
 * [ ] support markdown description from fba instructions and backgroundDescription
 * [ ] add support for reports (either as html embedded or as non interactive pngs)
 * [ ] support junit xml output format
 */
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

import { default as JSON5 } from 'json5'
import { default as jp } from 'jsonpath'

import chalk from 'chalk'
import cli_progress_pkg from 'cli-progress'
const { MultiBar, Format } = cli_progress_pkg
import { AdltRemoteClient, FileBasedMsgsHandler, MsgType, getAdltProcessAndPort } from './adltRemoteClient.js'
import { FBAttribute, FBBadge, FBFilter, Fishbone, getFBDataFromText, rqUriDecode } from './fbaFormat.js'
import {
  FbCategoryResult,
  FbEffectResult,
  FbRootCauseResult,
  FbaExecReport,
  FbaResult,
  fbReportToMdast,
  fbReportToJsonSummary,
  hideBadge2Value,
  hideBadgeValue,
  hideEvents,
} from './execReport.js'
import { Node } from 'unist'
import { inspect } from 'unist-util-inspect'
import { filter } from 'unist-util-filter'
import { assert as mdassert } from 'mdast-util-assert'
import { toMarkdown } from 'mdast-util-to-markdown'
import { ChildProcess } from 'child_process'
import path from 'path'
import { globAdltAlike, sleep } from './util.js'
import { gfmTableToMarkdown } from 'mdast-util-gfm-table'
import { satisfies } from 'semver'
import { DltFilter, FBSequence, FbEvent, FbSequenceResult, SeqChecker } from 'dlt-logs-utils/sequence'
import { AttributesValue, getAttributeFromFba, substAttributes, substFilterAttributes } from 'dlt-logs-utils/restQuery'

const MIN_ADLT_VERSION_SEMVER_RANGE = '>=0.61.0' // 0.61.0 needed for one_pass_streams support

const error = chalk.bold.red
const warning = chalk.bold.yellow

// const numberFormat = new Intl.NumberFormat('de-DE', { style: 'decimal', maximumFractionDigits: 0 })

export const cmdExec = async (files: string[], options: any) => {
  
  if (options.summary && !options.output){
    console.warn(error('Summary report requires output file via -o / --output to be specified!\n'))
    return
  }

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
        console.warn(error(`No 'dlt-logs.plugins' config array in config file '${options.config}'!\n`))
        return
      }
    } catch (e) {
      console.warn(error(`failed to load config file '${options.config}'! Got error:${e}\n`))
      return
    }
  }

  const sortOrderByTime = 'sortOrderByTime' in options ? !!options.sortOrderByTime : true

  for (const file of files) {
    // we support glob pattern (to ease windows usage)
    const globedFileNames = globAdltAlike(file)
    for (const gFile of globedFileNames) {
      if (gFile.endsWith('.fba')) {
        fbaFiles.push(gFile)
      } else {
        nonFbaFiles.push(gFile)
      }
    }
  }
  // console.log('exec: fba files:', fbaFiles)
  // console.log('exec: non fba files:', nonFbaFiles)

  if (fbaFiles.length === 0) {
    console.warn(warning('no fba files found!\n'))
    if (nonFbaFiles.length > 0) {
      console.warn(warning(`Dont' know what to do with the other ${nonFbaFiles.length} files!\n`))
    }
  } else {
    let totalNrOfMsgs: number | undefined = undefined

    const multibar = new MultiBar({
      forceRedraw: true,
      clearOnComplete: false,
      hideCursor: true,
      format: ' {bar} | {percentage}% | {value}/{total} | {file}',
      formatTime: (t, options, roundToMultipleOf) => {
        return Format.TimeFormat(t, options, roundToMultipleOf).padStart(5, ' ')
      },
    })
    const barAdlt = multibar.create(5, 0, { file: 'starting adlt' })
    const barMsgsLoadedOptions = {
      format: '                                    {duration_formatted} | {total} msgs read',
    }
    const barFbas = multibar.create(fbaFiles.length, 0)
    const barMsgsLoaded = multibar.create(0, 0, {}, barMsgsLoadedOptions)
    const barQueries = multibar.create(0, 0, { file: 'queries' })

    const fileBasedMsgsHandler: FileBasedMsgsHandler = (msg: MsgType) => {
      try {
        switch (msg.tag) {
          case 'FileInfo':
            {
              const fi = msg.value
              // receiving twice the same value indicates processing finished
              if (fi.nr_msgs === barMsgsLoaded.getTotal()) {
                totalNrOfMsgs = fi.nr_msgs
              } else {
                barMsgsLoaded.setTotal(fi.nr_msgs)
              }
            }
            break
          case 'Lifecycles':
            {
              // const li = msg.value
              //multibar.log(`Got ${li.length} lifecycles ${char4U32LeToString(li[0]?.ecu || 0)}\n`)
            }
            break
          case 'Progress': // todo show it? (e.g. during extraction of archives)
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
          console.warn(error(`Failed to start adlt! Got error:${e}\n`))
        },
      )
    }

    if (!adltWssPort) {
      multibar.stop()
      console.warn(
        error(
          `No adlt remote host:port to use! Please ensure that adlt is running and provide the port via the -p option or have adlt in path and don't provide the -p option!\n`,
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
        if (!satisfies(adltVersion, MIN_ADLT_VERSION_SEMVER_RANGE)) {
          multibar.log(`adlt version not fitting. Have ${adltVersion}! Needs ${MIN_ADLT_VERSION_SEMVER_RANGE}\n`)
          multibar.update()
          console.warn(error(`adlt version not fitting. Have ${adltVersion}! Needs ${MIN_ADLT_VERSION_SEMVER_RANGE}\n`))
          throw new Error(`adlt version not fitting. Have ${adltVersion}! Needs ${MIN_ADLT_VERSION_SEMVER_RANGE}`)
        }
        //multibar.log(`Connected to adlt...\n`)
        barAdlt.increment(1, { file: 'adlt connected' })
        // open files
        await adltClient
          .sendAndRecvAdltMsg(
            `open {"collect":"one_pass_streams", "sort":${sortOrderByTime},"files":${JSON.stringify(nonFbaFiles)},"plugins":${pluginCfgs}}`,
          )
          .then(async (response) => {
            report = {
              type: 'FbaExecReport',
              data: {
                date: new Date().toISOString(),
                adltVersion,
                files: nonFbaFiles,
                pluginCfgs,
                lifecycles: [],
              },
              children: [],
            }
            if (!response.startsWith('ok:')) {
              multibar.log(`Failed to open DLT files! Got response: '${response}'\n`)
              multibar.update()
              console.warn(error(`Failed to open DLT files! Got response:${response}\n`))
              return
            }
            // multibar.log(`Opened files...\n`)
            barAdlt.increment(1, { file: 'adlt files opened' })
            multibar.log(`Processing fba files...\n`)
            multibar.update()
            // exec the fba files (e.g. create/prepare all promises/queries...)
            const pending_promises: Promise<void>[] = []
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
              await processFbaFile(fbaFile, fbaResult, adltClient, {
                processBadge1: !options.no_badge1,
                processBadge2: !options.no_badge2,
                processsEvents: !options.no_events,
              }).then(
                async function (promises): Promise<void> {
                  //barFbas.increment(nrOfFbas)
                  pending_promises.push(...promises)
                  barQueries.setTotal(barQueries.getTotal() + promises.length)
                },
                (e): void => {
                  multibar.log(error(`Failed to process fba file:'${fbaFile}'! Got error:${e}`))
                },
              )
            }

            // now unpause the adlt client to start processing the queries
            if (pending_promises.length > 0) {
              await adltClient.sendAndRecvAdltMsg(`resume`).then(async (response) => {
                if (!response.startsWith('ok:')) {
                  multibar.log(`Failed to resume adlt! Got response: '${response}'\n`)
                  multibar.update()
                  console.warn(error(`Failed to resume adlt! Got response:${response}\n`))
                  return
                }
                multibar.log(`Processing DLT files with ${pending_promises.length} queries...\n`)

                // todo wait for all msgs being processed?
                // wait until all msgs are loaded (max 1h...)
                for (let i = 0; i < 3600; i++) {
                  await sleep(1000)
                  if (totalNrOfMsgs !== undefined) {
                    break
                  }
                }
                barAdlt.increment(1, { file: `adlt finished file processing` })

                // wait for all promises to finish
                await Promise.allSettled(pending_promises).then((results) => {
                  barQueries.increment(results.length)
                })
              })
            }
          })
          .catch((e) => {
            console.warn(error(`Failed to open DLT files! Got error:${e}\n`))
          })
      })
      .catch((e) => {
        console.warn(error(`Failed to connect to adlt! Got error:${e}\n`))
      })
      .finally(() => {
        adltClient.close()
        if (adltProcess) {
          try {
            adltProcess.kill()
          } catch (e) {
            console.warn(error(`Failed to kill adlt process! Got error:${e}\n`))
          }
        }
        barAdlt.increment(1, { file: `adlt closed` })
        if (report) {
          multibar.log(`Generating report...\n`)
          multibar.update()
          // update lifecycle summary
          report.data.lifecycles = Array.from(adltClient.lifecyclesByPersistentId).map(([_persistentId, lifecycle]) => lifecycle)

          //console.log(JSON.stringify(report, null, 2)) // use unist-util-inspect
          // console.log(`report is=${is(report, 'FbaExecReport')}`)
          // filter all value.badge = Number(0)
          report = filter(report, (node: Node) => {
            return (
              node.type !== 'FbRootCauseResult' ||
              !hideBadgeValue((node as FbRootCauseResult).value.badge) ||
              !hideBadge2Value((node as FbRootCauseResult).value.badge2) ||
              !hideEvents((node as FbRootCauseResult).value.events)
            )
          })
          if (report) {
            // convert by default to md/markdown
            const reportAsMd = fbReportToMdast(report)
            try {
              mdassert(reportAsMd)
              const reportAsMdText = toMarkdown(reportAsMd, { extensions: [gfmTableToMarkdown({ tablePipeAlign: false })] })
              if (!options.output) {
                console.log(reportAsMdText)
              }else{
                try{
                  // write an UTF8 BOM so that editors can easier detect the encoding:
                  fs.writeFileSync(options.output, '\ufeff')
                  fs.writeFileSync(options.output, reportAsMdText)
                  multibar.log(`Report written to '${options.output}'\n`)
                }catch(e){
                  multibar.log(`Failed to write report to '${options.output}'! Got error:${e}\n`)
                  console.warn(error(`Failed to write report to '${options.output}'! Got error:${e}\n`))
                }
                multibar.update()
              }
              if (options.summary){
                multibar.log(`Generating summary...\n`)
                const summary={
                  reportSummary: fbReportToJsonSummary(report)
                }
                console.log(`${JSON.stringify(summary, null, 2)}\n`)
                multibar.update()
              }
            } catch (e) {
              console.warn(inspect(reportAsMd))
              console.warn(`reportAsMd got error:${e}`)
            }
          }
        } else {
          console.warn(warning('failed to generate a report!\n'))
        }
        multibar.stop()
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

// eslint-disable-next-line no-useless-escape
const EVENT_FILTER_REGEXP = /\?\<EVENT_([a-zA-Z0-9]+?)_(.+?)\>/ // todo might weaken to EVENT_*_* as well if convFunction allowed/supported

const isEventFilter = (filter: any): boolean => {
  try {
    if (typeof filter === 'object' && filter.type === 3) {
      if (filter.payloadRegex && typeof filter.payloadRegex === 'string') {
        //const str = filter.payloadRegex as string
        return EVENT_FILTER_REGEXP.test(filter.payloadRegex)
      }
    }
  } catch (e) {
    console.warn(`isEventFilter got error: ${e}`)
  }
  return false
}

const processFilter = async (filter: FBFilter, getAttr: (attr:string)=>AttributesValue, adltClient: AdltRemoteClient, rcResult: { value: FbEvent[] | undefined }) => {
  try {
    if (filter.source && typeof filter.source === 'string' && filter.source.startsWith('ext:mbehr1.dlt-logs/')) {
      const rq = rqUriDecode(filter.source)
      if (rq.path.endsWith('/filters?')) {
        substAttributes(rq, getAttr, JSON5)
        // console.log(`got filter: ${JSON5.stringify(rq.commands.map((command)=>command.cmd))}`)
        for (const cmd of rq.commands) {
          switch (cmd.cmd) {
            case 'add':
            case 'delete':
            case 'disableAll':
            case 'deleteAll':
              break // ignore
            case 'report':
              {
                // for reports we use only the event filters
                // that captures with group name "EVENT_.+_.+" (EVENT_<type>_<title>)

                //console.log(`got filter cmd.report: ${JSON5.stringify(cmd.param.length)}`)
                const params = JSON5.parse(cmd.param)
                if (Array.isArray(params)) {
                  //console.log(` cmd.report params: ${JSON5.stringify(params)}`)
                  const eventFilters: any[] = []
                  for (const filter of params) {
                    if (isEventFilter(filter)) {
                      //console.log(` cmd.report event filter: ${JSON5.stringify(filter, (key, value) => key==='reportOptions' ? undefined: value)}`)
                      eventFilters.push(filter)
                    }
                  }
                  if (eventFilters.length > 0) {
                    await adltClient.getMatchingMessages(eventFilters, 1000).then((msgs) => {
                      // TODO: limit 1000???
                      try {
                        if (msgs.length > 0) {
                          const dltFilters = eventFilters.map((fObj) => new DltFilter(fObj))
                          // check which message matched and create an event with attributes: type, title, summary, ...
                          const events: FbEvent[] = []
                          for (const msg of msgs) {
                            const filter = dltFilters.find((filter) => filter.matches(msg))
                            if (filter !== undefined) {
                              const matches = filter.payloadRegex?.exec(msg.payloadString)
                              if (matches && matches.length > 0 && matches.groups) {
                                for (const group of Object.keys(matches.groups)) {
                                  const groupMatch = EVENT_FILTER_REGEXP.exec(`?<${group}>`)
                                  if (groupMatch) {
                                    const event: FbEvent = {
                                      evType: groupMatch[1],
                                      title: groupMatch[2],
                                      timeInMs: msg.receptionTimeInMs,
                                      // keep empty as we use the lifecycle time: msg.lifecycle? msg.lifecycle.lifecycleStart+msg.timeStamp
                                      timeStamp: msg.timeStamp,
                                      lifecycle: msg.lifecycle,
                                      summary: matches.groups[group],
                                      msgText: `#${msg.index} ${msg.timeStamp / 10000}s ${msg.ecu} ${msg.apid} ${msg.ctid} ${
                                        msg.payloadString
                                      }`,
                                    }
                                    events.push(event)
                                  }
                                }
                              }
                            }
                          }
                          //console.log(`processFilter.msgs got msgs:${msgs.length}`)
                          rcResult.value = events
                        }
                      } catch (e) {
                        console.warn(warning(`processFilter.msgs got error:${e}\n`))
                        // todo: where to return errors? rcResult.value = [`processFilter.msgs got error:${e}`]
                      }
                    })
                  }
                }
              }
              break
            default:
              // console.warn(`got filter cmd: ${JSON5.stringify(cmd)}\n`)
          }
        }
      }
    } else {
      console.warn(warning(`processFilter ignored:${JSON5.stringify(filter)}\n`))
    }
  } catch (e) {
    console.warn(warning(`processFilter got error:${e}\n`))
    // todo: where to put the errors? rcResult.value = [`processFilter got error:${e}`]
  }
}

const processBadge = async (
  badge: FBBadge,
  getAttr:(attr: string)=> AttributesValue,
  adltClient: AdltRemoteClient,
  rcResult: { value: string | number | FbSequenceResult[] | undefined },
) => {
  try {
    if (badge.conv && badge.source && typeof badge.source === 'string' && badge.source.startsWith('ext:mbehr1.dlt-logs/')) {
      const rq = rqUriDecode(badge.source)
      // console.log(`rqCmd.path=${rqCmd.path}`)
      if (rq.path.endsWith('/filters?')) {
        //console.log(`rq.commands=${JSON.stringify(rq.commands)}`)
        substAttributes(rq, getAttr, JSON5)
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
                      console.warn(`processBadge.msgs func got error:${e}`)
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
          } else if (cmd.cmd === 'sequences') {
            const sequences = JSON5.parse(cmd.param)
            if (Array.isArray(sequences) && sequences.length > 0) {
              processSequences(sequences, getAttr, adltClient, rcResult)
            } else {
              console.warn(`rq.cmd=${cmd} ignored as no sequences provided!`)
              rcResult.value = '<none>'
            }
          } else {
            console.warn(`rq.cmd=${cmd} ignored!\n`)
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

const processSequences = async (
  sequences: FBSequence[],
  getAttr:(attr: string)=> AttributesValue,
  adltClient: AdltRemoteClient,
  rcResult: { value: string | number | FbSequenceResult[] | undefined },
) => {
  try {
    const seqResults: FbSequenceResult[] = []

    // todo determine the dependecies between the sequences and process them in the right order
    // for now we start by using only the order provided
    // todo keep a map with sequence name to result value

    for (const jsonSeq of sequences) {
     // console.log(`processSequences: sequence('${jsonSeq.name}')=${JSON5.stringify(jsonSeq)}`)
      const seqResult: FbSequenceResult = {
        sequence: jsonSeq,
        occurrences: [],
        logs: [],
      }
      seqResults.push(seqResult)
      const seqChecker = new SeqChecker(jsonSeq, seqResult, DltFilter)

      // determine all filters to query from steps and failures:
      const allFilters = seqChecker.getAllFilters()
      if (allFilters.length === 0) {
        console.warn(`processSequences: no filters found for sequence '${seqChecker.name}'`)
        seqResult.logs.push(`no filters found for sequence '${seqChecker.name}'`)
        continue
      }
      substFilterAttributes(allFilters, getAttr) // does it inplace
      await adltClient.getMatchingMessages(allFilters, 1000000).then((msgs) => {
        // todo think about better way to limit. for now 1mio msgs
        try {
          seqResult.logs.push(`processed sequence '${seqChecker.name}' got ${msgs.length} msgs`)
          seqChecker.processMsgs(msgs)
          //console.log(`seqResult=${JSON.stringify(seqResult,null, 2)}`)
        } catch (e) {
          console.warn(`processSequences.msgs got error:${e}`)
          seqResult.logs.push(`processSequences.msgs got error:${e}`)
        }
      })
      // console.log(`processSequences: sequence('${seqChecker.name}') after await getMatchingMessages`)
    }
    rcResult.value = seqResults // todo wait for promises...
  } catch (e) {
    console.warn(`processSequences got error:${e}`)
    rcResult.value = `processSequences got error:${e}`
  }
}

const attrCacheCache = new Map<FBAttribute[], Map<string, AttributesValue>>()
const getAttribute = (fbaAttrs:FBAttribute[], attribute: string): AttributesValue => {
      // check if we already have the attribute in the cache
      let attrCache = attrCacheCache.get(fbaAttrs)
      if (attrCache=== undefined){
        attrCache = new Map<string, AttributesValue>()
        attrCacheCache.set(fbaAttrs, attrCache)
      }

      if (attrCache.has(attribute)) {
        return attrCache.get(attribute)
      }
      const toRet = getAttributeFromFba(fbaAttrs, attribute)
      attrCache.set(attribute, toRet)
      return toRet
    }

function iterateFbEffects(
  fba: Fishbone,
  fbaResult: FbaResult,
  adltClient: AdltRemoteClient,
  options: { processBadge1: boolean; processBadge2: boolean; processsEvents: boolean },
) {
  const promises: Promise<void>[] = []
  for (const effect of fba.fishbone) {
    const effectResult: FbEffectResult = {
      type: 'FbEffectResult',
      data: { ...effect },
      children: [],
    }
    delete effectResult.data.categories
    delete effectResult.data.fbUid

    const getAttr = (attr: string): AttributesValue => {
      return getAttribute(fba.attributes, attr) 
    }

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
            if (
              (options.processsEvents && rc.props?.filter) ||
              (options.processBadge1 && rc.props?.badge) ||
              (options.processBadge2 && rc.props?.badge2)
            ) {
              const rcResult: FbRootCauseResult = {
                type: 'FbRootCauseResult',
                data: {
                  ...rc,
                  name: rc.props.label,
                  backgroundDescription: rc.props.backgroundDescription,
                  instructions: rc.props.instructions,
                },
                value: {
                  badge: options.processBadge1 && rc.props.badge ? '<pending>' : undefined,
                  badge2: options.processBadge2 && rc.props.badge2 ? '<pending>' : undefined,
                  events: undefined,
                },
              }
              delete rcResult.data.type
              delete rcResult.data.element
              delete rcResult.data.fbUid
              delete rcResult.data.data
              delete rcResult.data.props

              categoryResult.children.push(rcResult)
              if (options.processBadge1 && rc.props.badge) {
                promises.push(processBadge(rc.props.badge, getAttr, adltClient, objectMember(rcResult.value, 'badge')))
              }
              if (options.processBadge2 && rc.props.badge2) {
                promises.push(processBadge(rc.props.badge2, getAttr, adltClient, objectMember(rcResult.value, 'badge2')))
              }
              if (options.processsEvents && rc.props.filter) {
                promises.push(processFilter(rc.props.filter, getAttr, adltClient, objectMember(rcResult.value, 'events')))
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
              promises.push(...iterateFbEffects({attributes: fba.attributes, title: rc.title || '<nested fishbone>', fishbone: rc.data}, nestedResult, adltClient, options))
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

const processFbaFile = async (
  filePath: string,
  fbaResult: FbaResult,
  adltClient: AdltRemoteClient,
  options: { processBadge1: boolean; processBadge2: boolean; processsEvents: boolean },
): Promise<Promise<void>[]> => {
  // try to open the file:
  return new Promise<Promise<void>[]>((resolve, reject) => {
    const fileAsPath = path.resolve(filePath)
    fs.readFile(fileAsPath, 'utf-8', (err, fbaFileContent) => {
      if (err) {
        // console.log(error(`Failed to read fba file:'${filePath}'! Got error:${err}`))
        fbaResult.data.errors.push(`Failed to read fba file '${filePath}' ('${fileAsPath.toString()}') due to: ${err}`)
        reject(err)
        return
      }
      try {
        const fba = getFBDataFromText(fbaFileContent)
        fbaResult.data.fbaTitle = fba.title
        const promises = iterateFbEffects(fba, fbaResult, adltClient, options)
        resolve(promises)
      } catch (e) {
        fbaResult.data.errors.push(`Processing fba got error: ${e}`)
        reject(e)
      }
    })
  })
}
