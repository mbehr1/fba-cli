import { WebSocket } from 'ws'
import { spawn, ChildProcess } from 'child_process'
import * as remote_types from './remote_types.js'
import { retryOperation } from './util.js'
import { WriteStream } from 'fs'

export type MsgType = remote_types.BinType
export type FileBasedMsgsHandler = (msg: remote_types.BinType) => void

export interface NewMessageSink {
  onNewMessages?: (nrNewMsgs: number) => void
  onDone?: () => void
  onStreamInfo?: (nrStreamMsgs: number, nrMsgsProcessed: number, nrMsgsTotal: number) => void
}

// map ecu/apid/ctids
export interface EAC {
  e: string
  a: string
  c: string
}

const mapEAC: Map<number, EAC> = new Map()
const maprEAC: Map<string, Map<string, Map<string, number>>> = new Map()
let maxEAC: number = 0

export function getIdxFromEAC(eac: EAC): number {
  let eMap = maprEAC.get(eac.e)
  if (eMap === undefined) {
    eMap = new Map<string, Map<string, number>>()
    maprEAC.set(eac.e, eMap)
  }
  let aMap = eMap.get(eac.a)
  if (aMap === undefined) {
    aMap = new Map<string, number>()
    eMap.set(eac.a, aMap)
  }
  let idx = aMap.get(eac.c)
  if (idx !== undefined) {
    return idx
  } else {
    idx = ++maxEAC
    aMap.set(eac.c, idx)
    mapEAC.set(idx, eac)
    return idx
  }
}
export function getEACFromIdx(idx: number): EAC | undefined {
  const eac = mapEAC.get(idx)
  return eac
}

export function char4U32LeToString(char4le: number): string {
  let codes = [char4le & 0xff, 0xff & (char4le >> 8), 0xff & (char4le >> 16), 0xff & (char4le >> 24)]
  while (codes.length > 0 && codes[codes.length - 1] === 0) {
    codes.splice(-1)
  }
  return String.fromCharCode(...codes)
}

export interface RestObject {
  id: string | number
  type: string
  attributes?: object
  // relationsships
  // links
  meta?: object
}

export interface DltLifecycleInfoMinIF {
  ecu: string
  ecuLcNr?: number // the number shown in the tree view
  persistentId: number
  lifecycleStart: Date
  isResume?: boolean // is this a resumed lifecycle?
  lifecycleResume?: Date // resume time if any. use this instead of lifecycleStart then.
  lifecycleEnd: Date
  getTreeNodeLabel(): string
  tooltip: string
  swVersions: string[]
  apidInfos?: Map<string, { apid: string; desc: string; ctids: Map<string, string> }>
  nrMsgs: number
  //logMessages?: DltMsg[],
  //decorationType?: vscode.TextEditorDecorationType,
  //node?: LifecycleNode,
}

export interface FilterableDltMsg {
  timeStamp: number // timestamp_dms [deci=0.1 ms]
  mstp: number
  mtin: number
  //readonly mcnt: number,
  ecu: string
  apid: string
  ctid: string
  verbose: boolean
  payloadString: string
  lifecycle?: DltLifecycleInfoMinIF

  asRestObject(idHint: number): RestObject
}

export interface ViewableDltMsg extends FilterableDltMsg {
  receptionTimeInMs: number
  index: number
  mcnt: number
}

export const MTIN_LOG_strs: string[] = ['', 'fatal', 'error', 'warn', 'info', 'debug', 'verbose', '', '', '', '', '', '', '', '', '']

class AdltMsg implements ViewableDltMsg {
  _eac: EAC
  index: number
  htyp: number
  receptionTimeInMs: number
  timeStamp: number
  // lifecycle?: DltLifecycleInfoMinIF | undefined
  lifecycle_id: number
  mcnt: number
  mstp: number
  mtin: number
  verbose: boolean
  payloadString: string

  constructor(binMsg: remote_types.BinDltMsg /*, lifecycle?: DltLifecycleInfoMinIF*/) {
    // cached ECU, APID, CTID:
    this._eac = getEACFromIdx(
      getIdxFromEAC({ e: char4U32LeToString(binMsg.ecu), a: char4U32LeToString(binMsg.apid), c: char4U32LeToString(binMsg.ctid) }),
    )!

    this.index = binMsg.index
    this.receptionTimeInMs = Number(binMsg.reception_time / 1000n)
    this.timeStamp = binMsg.timestamp_dms
    //this.lifecycle = lifecycle
    this.lifecycle_id = binMsg.lifecycle_id
    this.htyp = binMsg.htyp
    this.mcnt = binMsg.mcnt
    this.mstp = (binMsg.verb_mstp_mtin >> 1) & 0x7
    this.mtin = (binMsg.verb_mstp_mtin >> 4) & 0xf
    this.verbose = (binMsg.verb_mstp_mtin & 0x01) === 0x01
    this.payloadString = binMsg.payload_as_text
  }
  get ecu(): string {
    return this._eac.e
  }
  get apid(): string {
    return this._eac.a
  }
  get ctid(): string {
    return this._eac.c
  }

  asRestObject(idHint: number): RestObject {
    return {
      id: this.index,
      type: 'msg',
      attributes: {
        timeStamp: this.timeStamp,
        ecu: this.ecu,
        mcnt: this.mcnt,
        apid: this.apid,
        ctid: this.ctid,
        mtin: MTIN_LOG_strs[this.mtin],
        payloadString: this.payloadString,
        lifecycle: this.lifecycle_id, // this.lifecycle ? this.lifecycle.persistentId : undefined,
      },
    }
  }
}

export interface StreamMsgData {
  msgs: AdltMsg[]
  sink: NewMessageSink
}

export class AdltRemoteClient {
  private webSocket?: WebSocket
  adltVersion?: string
  webSocketIsConnected: boolean = false
  webSocketErrors: string[] = []

  private _reqCallbacks: ((resp: string) => void)[] = []
  private streamMsgs = new Map<number, StreamMsgData | remote_types.BinType[]>()

  constructor(private fileBasedMsgsHandler: FileBasedMsgsHandler) {}

  close() {
    if (this.webSocket) {
      // todo if connected???
      this.webSocket.close()
    }
  }

  /**
   * connect to (an existing) adlt process via websocket
   *
   * Does not start the adlt process!
   *
   * @param wssUrl url of the adlt remote websocket. e.g. ws://localhost:7777
   * @returns the adlt version connected to
   */
  connectToWebSocket(wssUrl: string): Promise<string> {
    const webSocket = new WebSocket(wssUrl, [], { perMessageDeflate: false, origin: 'adlt-logs', maxPayload: 1_000_000_000 })
    this.webSocket = webSocket
    webSocket.binaryType = 'arraybuffer' // todo ArrayBuffer needed for sink?
    return new Promise((resolve, reject) => {
      let promiseWaits = true

      webSocket.on('message', (data: ArrayBuffer, isBinary) => {
        try {
          if (isBinary) {
            this.onBinaryMessage(data)
          } else {
            const text = data.toString()
            if (text.startsWith('info:')) {
              // todo still used?
              console.info(`AdltRemoteClient.on(message) info:`, text)
            } else if (this._reqCallbacks.length > 0) {
              // response to a request:
              // console.info(`AdltRemoteClient.on(message) response for request:`, text)
              let cb = this._reqCallbacks.shift()
              if (cb) {
                cb(text)
              }
            } else {
              console.warn(`AdltRemoteClient.on(message) unexpected text=`, text)
            }
          }
        } catch (e) {
          console.error(`ws on message got error:${e}\n`)
        }
      })
      webSocket.on('upgrade', (response) => {
        // console.log(`AdltRemoteClient.on(upgrade) got response:`) //, response)
        let ah = response.headers['adlt-version']
        this.adltVersion = ah && !Array.isArray(ah) ? ah : ah && Array.isArray(ah) ? ah.join(',') : undefined
        if (this.adltVersion) {
          /*
        if (!semver.satisfies(this.adltVersion, MIN_ADLT_VERSION_SEMVER_RANGE)) {
          vscode.window.showErrorMessage(
            `Your adlt version is not matching the required version!\nPlease correct!\nDetected version is '${this.adltVersion}' vs required '${MIN_ADLT_VERSION_SEMVER_RANGE}.'`,
            { modal: true },
          )
        } else {
          console.log(`adlt.AdltDocumentProvider got matching adlt version ${this.adltVersion} vs ${MIN_ADLT_VERSION_SEMVER_RANGE}.`)
        }*/
          //console.log(`AdltRemoteClient.on(upgrade) got adlt version:${this.adltVersion}`)
        }
      })
      webSocket.on('open', () => {
        this.webSocketIsConnected = true
        this.webSocketErrors = []
        if (promiseWaits) {
          promiseWaits = false
          resolve(this.adltVersion || 'no version')
        }
      })

      webSocket.on('close', () => {
        this.webSocketIsConnected = false
        this.webSocketErrors.push('wss closed')
        // console.warn(`AdltRemoteClient.on(close) wss got close`)
        // this.emitStatusChanges.fire(this.uri)
      })
      webSocket.on('error', (err) => {
        console.warn(`AdltRemoteClient.on(error) wss got error:`, err)
        this.webSocketErrors.push(`error: ${err}`)
        if (promiseWaits) {
          promiseWaits = false
          reject(err)
        }
        // this.emitStatusChanges.fire(this.uri)
      })
    })
  }

  sendAndRecvAdltMsg(req: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.webSocket) {
        this._reqCallbacks.push((response: string) => {
          // if we get an error/n ok we do reject as well:
          if (response.startsWith('ok:')) {
            resolve(response)
          } else {
            console.warn(`AdltRemoteClient.sendAndRecvAdltMsg got nok ('${response}') for request '${req}'`)
            reject(response)
          }
        })
        this.webSocket.send(req, (err) => {
          if (err) {
            console.warn(`AdltRemoteClient.sendAndRecvAdltMsg wss got error:`, err)
            this.webSocketErrors.push(`wss send failed with:${err}`)
            // todo! this.emitStatusChanges.fire(this.uri);
          }
        })
      } else {
        console.error(`AdltRemoteClient.sendAndRecvAdltMsg got no webSocket yet!`)
        reject(`AdltRemoteClient.sendAndRecvAdltMsg got no webSocket yet!`)
      }
    })
  }

  private onBinaryMessage(data: ArrayBuffer) {
    try {
      const bin_type = remote_types.readBinType(data)
      switch (bin_type.tag) {
        case 'DltMsgs':
        case 'StreamInfo':
          {
            let streamId = bin_type.tag === 'DltMsgs' ? bin_type.value[0] : bin_type.value.stream_id
            let streamData = this.streamMsgs.get(streamId)
            if (streamData && !Array.isArray(streamData)) {
              this.processBinStreamMsgs(bin_type, streamData)
            } else {
              // we store the pure data for later processing:
              if (!streamData) {
                streamData = [bin_type]
                this.streamMsgs.set(streamId, streamData)
              } else {
                streamData.push(bin_type)
                if (streamData.length > 3) {
                  console.warn(
                    `adlt.on(binary): appended ${bin_type.tag} for yet unknown stream=${streamId}, streamData.length=${streamData.length}`,
                  )
                }
              }
            }
          }
          break
        case 'FileInfo':
        case 'Lifecycles':
        case 'EacInfo':
        case 'Progress':
        case 'PluginState':
          {
            this.fileBasedMsgsHandler(bin_type)
          }
          break
        default:
          console.warn(`ws on binary message ignored:${(bin_type as unknown as any).tag}`)
          break
      }
    } catch (e) {
      console.error(`ws on binary message got error:${e}\n`)
    }
  }

  processBinStreamMsgs(bin_type: remote_types.BinType, streamData: StreamMsgData) {
    try {
      switch (bin_type.tag) {
        case 'DltMsgs':
          const [streamId, msgs] = bin_type.value
          if (msgs.length === 0) {
            // indicates end of query:
            if (streamData.sink.onDone) {
              streamData.sink.onDone()
            }
            this.streamMsgs.delete(streamId)
            //console.error(`adlt.processBinDltMsgs deleted stream #${streamId}\n\n`)
          } else {
            for (let i = 0; i < msgs.length; ++i) {
              let binMsg = msgs[i]

              let msg = new AdltMsg(binMsg /*, this.lifecycleInfoForPersistentId(binMsg.lifecycle_id)*/)
              streamData.msgs.push(msg)
            }
            if (streamData.sink.onNewMessages) {
              streamData.sink.onNewMessages(msgs.length)
            }
          }
          break
        case 'StreamInfo':
          const si = bin_type.value
          // console.log(`adlt.processBinStreamMsgs: StreamInfo stream=${si.stream_id}, stream msgs=${si.nr_stream_msgs} processed=${si.nr_file_msgs_processed} total=${si.nr_file_msgs_total}`);
          if (streamData.sink.onStreamInfo) {
            streamData.sink.onStreamInfo(si.nr_stream_msgs, si.nr_file_msgs_processed, si.nr_file_msgs_total)
          }
          break
      }
    } catch (e) {
      console.error(`adlt.processBinStreamMsgs got error:${e}\n`)
    }
  }

  /**
   * calculate and return the matching messages. Does not modify the current content/view.
   * @param filters list of filters to use. Should only be pos and neg filters. Others will be ignored.
   * @param maxMsgsToReturn maximum number of messages to return. As this is no async function the caller
   * needs to be careful!
   * @returns list of matching messages (as Promise)
   */
  getMatchingMessages(filters: any[], maxMsgsToReturn: number): Promise<ViewableDltMsg[]> {
    let p = new Promise<ViewableDltMsg[]>((resolve, reject) => {
      const matchingMsgs: AdltMsg[] = []
      // sort the filters here into the enabled pos and neg:
      try {
        let filterStr = filters
          .filter((f) => ('enabled' in f ? f.enabled : true))
          .map((f) => JSON.stringify({ ...f, enabled: true }))
          .join(',')
        this.sendAndRecvAdltMsg(`query {"window":[0,${maxMsgsToReturn}], "filters":[${filterStr}]}`)
          .then((response) => {
            const streamObj = JSON.parse(response.substring(10))

            let sink: NewMessageSink = {
              onDone() {
                // console.log(`adlt.getMatchingMessages done matchingMsgs.length=${matchingMsgs.length}`)
                resolve(matchingMsgs)
              },
            }
            // here some data might be already there for that stream.
            // this can happen even though the wss data arrives sequentially but the processing
            // here for wss data is a direct call vs. an asyn .then()...
            let curStreamMsgData = this.streamMsgs.get(streamObj.id)
            let streamData = { msgs: matchingMsgs, sink: sink }
            this.streamMsgs.set(streamObj.id, streamData)
            if (curStreamMsgData && Array.isArray(curStreamMsgData)) {
              // process the data now:
              curStreamMsgData.forEach((msgs) => this.processBinStreamMsgs(msgs, streamData))
            }
          })
          .catch((reason) => {
            reject(reason)
          })
      } catch (e) {
        throw new Error(`getMatchingMessages failed due to error '${e}'`)
        reject(e)
      }
    })
    return p
  }
}

/**
 * get the host&port (e.g. 127.0.0.1:7777) & spawned process of adlt process.
 * Starts adlt and tries to find an open port in range
 * 6700-6789.
 *
 * Sets internal variables _adltProcess and _adltPort as well.
 * @returns a promise for the host&port and the spawned process
 */
export function getAdltProcessAndPort(
  adltCommand: string,
  outStream: WriteStream,
): Promise<{ hostAndPort: string; process: ChildProcess }> {
  return new Promise<{ hostAndPort: string; process: ChildProcess }>((resolve, reject) => {
    // start it
    // currently it retries 89 times even if spawnAdltProcess rejects with ENOENT! todo

    retryOperation((retries_left: number) => spawnAdltProcess(adltCommand, 6789 - retries_left, outStream), 10, 89)
      .then(([childProc, port]) => {
        resolve({ hostAndPort: `127.0.0.1:${port}`, process: childProc })
      })
      .catch((reason) => {
        reject(reason)
      })
  })
}

/**
 * spawn an adlt process at specified port.
 *
 * Checks whether the process could be started sucessfully and
 * whether its listening on the port.
 *
 * Uses adltCommand to start the process and the params 'remote -p<port>'.
 *
 * It listens on stdout and stderr (and on 'close' and 'error' events) and forwards output to the outStream.
 * This could be improved/changed to listen only until a successful start is detected.
 *
 * Rejects with 'ENOENT' or 'AddrInUse' or 'did close unexpectedly' in case of errors.
 *
 * @param port number of port to use for remote websocket
 * @returns pair of ChildProcess started and the port number
 */
function spawnAdltProcess(adltCommand: string, port: number, outStream: WriteStream): Promise<[ChildProcess, number]> {
  return new Promise<[ChildProcess, number]>((resolve, reject) => {
    let finishedListening = [false] // todo could be a regular boolean
    let childProc = spawn(adltCommand, ['remote', `-p=${port}`], { detached: false, windowsHide: true })
    childProc.on('error', (err) => {
      outStream.write(`spawnAdltProcess process got err='${err}'\n`)
      if (!finishedListening[0] && err.message.includes('ENOENT')) {
        finishedListening[0] = true
        reject(`ENOENT - ${adltCommand} not found in path?. Detail error: ${err.message}`)
      }
    })
    childProc.on('close', (code, signal) => {
      outStream.write(`spawnAdltProcess(port=${port}) process got close code='${code}' signal='${signal}'\n`)
      if (!finishedListening[0]) {
        finishedListening[0] = true
        reject('did close unexpectedly')
      }
    })
    childProc?.stdout?.on('data', (data) => {
      // todo or use 'spawn' event?
      try {
        if (!finishedListening[0] && `${data}`.includes('remote server listening on')) {
          finishedListening[0] = true // todo stop searching for ... (might as well stop listening completely for stdout)
          resolve([childProc, port])
        }
        outStream.write(data)
      } catch (err) {
        outStream.write(`spawnAdltProcess(port=${port}) process stdout got err='${err}, typeof data=${typeof data}'\n`)
      }
    })
    childProc?.stderr?.on('data', (data) => {
      outStream.write(`spawnAdltProcess(port=${port}) process got stderr='${data}'\n`)
      if (!finishedListening[0] && `${data}`.includes('AddrInUse')) {
        finishedListening[0] = true
        reject('AddrInUse')
      }
    })
  })
}
