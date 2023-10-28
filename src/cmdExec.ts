/**
 * todos:
 * [] add glob support for files passed as arguments
 */
import fs from 'fs'

import { default as JSON5 } from 'json5'
import { default as jp } from 'jsonpath'

import chalk from 'chalk'
import { MultiBar } from 'cli-progress'
import { AdltRemoteClient, FileBasedMsgsHandler, MsgType, char4U32LeToString } from './adltRemoteClient.js'
import { FBBadge, getFBDataFromText, iterateAllFBElements, rqUriDecode } from './fbaFormat.js'

const error = chalk.bold.red
const warning = chalk.bold.yellow

export const cmdExec = async (files: string[], options: any) => {
  console.log('cmdExec', files, options)

  const fbaFiles: string[] = []
  const nonFbaFiles: string[] = []

  const pluginCfgs = JSON.stringify([]) // todo
  const sortOrderByTime = 'sortOrderByTime' in options ? !!options.sortOrderByTime : true

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
    const barAdlt = multibar.create(5, 0, { file: 'starting adlt' })
    const barMsgsLoadedOptions = {
      format: '                                      {duration}s | {total} msgs read',
    }
    const barMsgsLoaded = multibar.create(100, 0, {}, barMsgsLoadedOptions)
    const barFbas = multibar.create(fbaFiles.length, 0)

    const fileBasedMsgsHandler: FileBasedMsgsHandler = (msg: MsgType) => {
      switch (msg.tag) {
        case 'FileInfo':
          const fi = msg.value
          barMsgsLoaded.setTotal(fi.nr_msgs)
          break
        case 'Lifecycles':
          const li = msg.value
          multibar.log(`Got ${li.length} lifecycles ${char4U32LeToString(li[0]?.ecu || 0)}\n`)
          break
      }
    }

    const adltClient = new AdltRemoteClient(fileBasedMsgsHandler)
    // start adlt
    multibar.log(`Starting adlt...\n`)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // todo add parameter!
    //multibar.log(`Connecting to adlt...\n`)
    barAdlt.increment(1, { file: 'adlt connecting' })
    adltClient
      .connectToWebSocket('ws://127.0.0.1:7777')
      .then(async (adltVersion) => {
        //multibar.log(`Connected to adlt...\n`)
        barAdlt.increment(1, { file: 'adlt connected' })
        // open files
        await adltClient
          .sendAndRecvAdltMsg(`open {"sort":${sortOrderByTime},"files":${JSON.stringify(nonFbaFiles)},"plugins":${pluginCfgs}}`)
          .then(async (response) => {
            // todo check response
            // multibar.log(`Opened files...\n`)
            barAdlt.increment(1, { file: 'adlt files opened' })
            // console.log('response:', response)
            await adltClient.getMatchingMessages([{ enabled: true, ecu: 'E002', type: 0 }], 1000).then(
              (msgs) => {
                multibar.log(`Got ${msgs.length} msgs\n`)
              },
              (e) => {
                multibar.log(`Got ${e}  on getMatchingMsgs\n`)
              },
            )
            // wait 5s
            //await new Promise((resolve) => setTimeout(resolve, 5000))
            barAdlt.increment(1, { file: 'adlt started' })
            // load dlt files
            //multibar.log(`Processing DLT files...\n`)
            // exec the fba files
            for (const fbaFile of fbaFiles) {
              barFbas.increment(1, { file: fbaFile })
              // console.log(`executing fba file:'${fbaFile}'`)
              await processFbaFile(fbaFile, adltClient).then(
                (nrOfFbas) => {
                  //barFbas.increment(nrOfFbas)
                },
                (e) => {
                  console.log(error(`Failed to process fba file:'${fbaFile}'! Got error:${e}`))
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
        adltClient.close()
        multibar.stop()
        console.log(warning('finally...'))
      })
  }
}

const processBadge = async (badge: FBBadge, adltClient: AdltRemoteClient) => {
  try {
    console.log(` badge=${JSON.stringify(badge)}`)
    if (badge.conv && badge.source.startsWith('ext:mbehr1.dlt-logs/')) {
      const rq = rqUriDecode(badge.source)
      // console.log(`rqCmd.path=${rqCmd.path}`)
      if (rq.path.endsWith('/filters?')) {
        console.log(`rq.commands=${JSON.stringify(rq.commands)}`)
        for (const cmd of rq.commands) {
          if (cmd.cmd === 'query') {
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
                if (convResult !== undefined) {
                  console.log(`badge.conv='${convResult}'`)
                }
              } catch (e) {
                console.warn(`processBadg.msgs got error:${e}`)
              }
            })
          } else {
            console.log(`rq.cmd=${cmd} ignored!`)
          }
        }
      }
    }
  } catch (e) {
    console.warn(`processBadge got error:${e}`)
  }
}

const processFbaFile = async (filePath: string, adltClient: AdltRemoteClient) => {
  // try to open the file:
  return new Promise<number>((resolve, reject) => {
    fs.readFile(filePath, 'utf-8', (err, fbaFileContent) => {
      if (err) {
        console.log(error(`Failed to read fba file:'${filePath}'! Got error:${err}`))
        reject(err)
        return
      }
      try {
        const fba = getFBDataFromText(fbaFileContent)
        console.log(`fba.title=${fba.title}`)
        iterateAllFBElements(fba.fishbone, [], async (fbType, fbElement, parent) => {
          if (fbType === 'rc' && typeof fbElement === 'object' && fbElement.type === 'react' && fbElement.element === 'FBACheckbox') {
            //console.log(`fbType=${fbType}, fbElement.type=${fbElement.type},fbElement.element=${fbElement.element} parent=${parent.name}`)
            if (fbElement.props?.badge) {
              processBadge(fbElement.props.badge, adltClient)
            }
            if (fbElement.props?.badge2) {
              processBadge(fbElement.props.badge2, adltClient)
            }
          }
        })
        resolve(1)
      } catch (e) {
        reject(e)
      }
    })
  })
  // await new Promise((resolve) => setTimeout(resolve, 2000))
}
