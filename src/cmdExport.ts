import fs from 'fs'

import chalk from 'chalk'
import filenamify from 'filenamify'
import { default as JSON5 } from 'json5'
import JSZip from 'jszip'
import { fragment, convert, create } from 'xmlbuilder2'

import { FBEffect, Fishbone, getFBDataFromText, rqUriDecode } from './fbaFormat.js'
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js'
import { version, containsRegexChars } from './util.js'
import { finished } from 'node:stream/promises'

const error = chalk.bold.red
const warning = chalk.bold.yellow
const green = chalk.bold.green

export const cmdExport = async (fbaFilePath: string, zipFilePath: string, options: any) => {
  const { format } = options
  console.log(`export format '${format}' from '${fbaFilePath}' to '${zipFilePath}''`)
  switch (format.toLowerCase()) {
    case 'dlt-viewer':
      {
        await openFbaFile(fbaFilePath)
          .then(async (fba) => {
            // create the output zip file:
            const zipFile = new JSZip()
            exportToDltViewer(fba, zipFile)
            /*zipFile.filter((path, file) => {
              console.log(`zipFile: path='${path}'`)
              return false
            })*/
            const ws = fs.createWriteStream(zipFilePath)

            zipFile
              .generateNodeStream({ type: 'nodebuffer', streamFiles: false, compression: 'DEFLATE' })
              .pipe(ws)
              .on('finish', () => {
                // console.log(green(`successfully wrote '${zipFilePath}'`))
              })

            await finished(ws).then(
              () => {
                console.log(green(`successfully finished writing '${zipFilePath}'`))
              },
              (err) => {
                console.log(error(`writing '${zipFilePath}' got error:${err}`))
              },
            )
            console.log(green(`...export done.`))
          })
          .catch((e) => {
            console.log(error(`export got error:${e}`))
          })
      }
      break
    default:
      console.log(error(`unknown export format '${format}'`))
      break
  }
}

function openFbaFile(filePath: string): Promise<Fishbone> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, fbaFileContent) => {
      if (err) {
        reject(err)
      } else {
        try {
          const fba = getFBDataFromText(fbaFileContent)
          resolve(fba)
        } catch (e) {
          reject(e)
        }
      }
    })
  })
}

function exportToDltViewer(fba: Fishbone, zipFile: JSZip) {
  console.log(`exportToDltViewer fba.title='${fba.title}'`)
  const exportedFilters = iterateFbEffects(fba.fishbone, zipFile, [])
  if (exportedFilters > 0) {
    console.log(green(`finished exporting ${exportedFilters} filters to dlt-viewer format`))
  } else {
    console.log(warning(`no filters exported to dlt-viewer format`))
  }
}

function pathNameFor(title: string, curSet: Set<String>, addToSet: boolean): string {
  let titleName = filenamify(title, { replacement: '_' })

  // check if titleName is already in curSet:
  let i = 2
  while (curSet.has(titleName)) {
    titleName = filenamify(title, { replacement: '_' }) + '_' + i
    i++
  }
  if (addToSet) {
    curSet.add(titleName)
  }

  return titleName
}

function iterateFbEffects(effects: FBEffect[], zipFile: JSZip, prevPaths: string[]): number {
  let exportedFilters = 0
  const effectFolderNamesUsed = new Set<string>()
  for (const effect of effects) {
    if (effect !== undefined && typeof effect === 'object') {
      const pathNameForEffect = pathNameFor(effect.name || 'effect', effectFolderNamesUsed, true)
      console.log(`effect: '${prevPaths.join('/') + pathNameForEffect}'...`) // , Object.keys(effect).join(', '))
      if (effect.categories?.length) {
        const categoryFolderNamesUsed = new Set<string>()
        for (const category of effect.categories) {
          if (category !== undefined && typeof category === 'object') {
            const pathNameForCategory = pathNameFor(category.name || 'category', categoryFolderNamesUsed, true)
            console.log(`category: '${pathNameForCategory}'...`) // , Object.keys(category).join(', '))
            const rootCauseFolderNamesUsed = new Set<string>()
            const rcNumberLen = category.rootCauses.length.toString().length
            for (const [rcIdx, rc] of category.rootCauses.entries()) {
              if (rc !== undefined && typeof rc === 'object') {
                const rcPrefix = (1 + rcIdx).toString().padStart(rcNumberLen, '0') + '_'
                // console.log(`rootCause: '${rcPrefix}' type:'${rc.type}' element:'${rc.element}'`, Object.keys(rc).join(', '))
                if (rc.type === 'nested' && Array.isArray(rc.data)) {
                  const pathNameForRootCause = pathNameFor(
                    rcPrefix + (rc.title || rc.props?.label || 'rootCause'),
                    rootCauseFolderNamesUsed,
                    false,
                  )
                  // rootCauseFolderNamesUsed.add(pathNameForRootCause)
                  iterateFbEffects(rc.data, zipFile, prevPaths.concat([pathNameForEffect, pathNameForCategory, pathNameForRootCause]))
                } else {
                  if (rc.type === 'react' && rc.element === 'FBACheckbox' && rc.props !== undefined) {
                    const pathNameForRootCause = pathNameFor(rc.title || rc.props?.label || 'rootCause', rootCauseFolderNamesUsed, false)
                    // no need to add as it will always be unique
                    const checkboxProps = rc.props
                    // console.log(`checkbox label: '${checkboxProps.label}'`)
                    // 3 possible filter sources:
                    // - checkboxProps.filter
                    // - checkboxProps.badge.source
                    // - checkboxProps.badge2.source
                    exportedFilters += exportFilter(
                      checkboxProps.filter?.source,
                      zipFile,
                      prevPaths.concat([pathNameForEffect, pathNameForCategory, rcPrefix + 'apply_' + pathNameForRootCause]),
                    )
                    exportedFilters += exportFilter(
                      checkboxProps.badge?.source,
                      zipFile,
                      prevPaths.concat([pathNameForEffect, pathNameForCategory, rcPrefix + 'badge1_' + pathNameForRootCause]),
                    )
                    exportedFilters += exportFilter(
                      checkboxProps.badge2?.source,
                      zipFile,
                      prevPaths.concat([pathNameForEffect, pathNameForCategory, rcPrefix + 'badge2_' + pathNameForRootCause]),
                    )
                  } else {
                    console.log(warning(`ignored rootCause type='${rc.type}' element='${rc.element}'`))
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return exportedFilters
}

function exportFilter(filter: any, zipFile: JSZip, dirs: string[]): number {
  // some params to ignore:
  if (filter === undefined || filter === null || filter === '') {
    return 0
  }
  if (typeof filter !== 'string') {
    console.log(warning(`exported filter: not a string! keys='${Object.keys(filter).join(',')}', filter='${JSON.stringify(filter)}'`))
  }
  if (filter.startsWith('ext:mbehr1.dlt-logs/')) {
    try {
      let exportedFilters: XMLBuilder[] = []
      const rq = rqUriDecode(filter)
      if (rq.path.endsWith('/filters?')) {
        if (rq.commands.length > 0) {
          for (const command of rq.commands) {
            switch (command.cmd) {
              case 'add': // params = single filterFrag object
              case 'query': // params = array of filterFrags
                try {
                  const params = command.cmd === 'add' ? [JSON5.parse(command.param)] : JSON5.parse(command.param)
                  if (Array.isArray(params) && params.length > 0 && params.every((e) => typeof e === 'object')) {
                    let xmlFrags = params.map(exportFilterFrags).flat()
                    exportedFilters.push(...xmlFrags)
                  } else {
                    console.log(warning(`exporting filter: not array or empty! cmd:'${command.cmd}' params:'${params}'`))
                  }
                } catch (e) {
                  console.log(warning(`exporting filter: json parsing: '${command.param} got error: ${e}'`))
                }
                break
              case 'report': // do we need to treat this differently?
                // params expected to be an array
                break
              case 'delete': // can be ignored without warning
              case 'deleteAll':
              case 'disableAll':
              case 'enableAll':
              case 'patch':
                break
              default:
                console.log(warning(` unknown command=${command.cmd}`))
            }
          }
        }
      } else {
        console.log(warning(`exporting filter: ignored rest query '${rq.path}'`))
      }
      if (exportedFilters.length > 0) {
        // console.log(green(`exported ${exportedFilters.length} filter...`))
        // console.log(green(`exporting filter: xml='${exportedFilters.map((p) => p.toString()).join(',')}'`))
        let xml = create({ version: '1.0', encoding: 'UTF-8' }).ele('dltfilter')
        xml.com(`exported by fba-cli v${version()}`)
        for (const xmlFrag of exportedFilters) {
          xml.import(xmlFrag)
        }
        const xmlFileContent = xml.end({ prettyPrint: true })
        //console.log(green(`exporting filter: xml='${xmlFileContent.length}'`))
        zipFile.file(dirs.join('/') + '.dlf', xmlFileContent)
      }
      return exportedFilters.length
    } catch (e) {
      console.log(warning(`exporting filter: '${filter.slice(0, 100)} got error: ${e}'`))
      return 0
    }
  } else {
    console.log(warning(`ignored filter, not a dlt-logs filter! filter='${filter}'`))
    return 0
  }
}

function exportFilterFrags(filterFrag: any): XMLBuilder[] {
  // console.log(`exportFilterFrags: '${JSON.stringify(filterFrag)}'`)
  // attributes to not export: tmpFb, not, lifecycles
  // special handling for lifecycle neg filter:
  if (filterFrag.lifecycles !== undefined && filterFrag.not === true && filterFrag.type === 1) {
    // remove the known/expected keys:
    const { not: _a, lifecycles: _b, tmpFb: _c, type: _d, name: _e, maxNrMsgs: _f, atLoadTime: _g, ...remObj } = filterFrag
    if (Object.keys(remObj).length > 0) {
      console.log(
        warning(`exporting filter: ignored empty filter! keys='${Object.keys(remObj).join(',')}' filter='${JSON.stringify(remObj)}'`),
      )
    }
    return []
  }
  // remove the not to export/to be ignored properties:
  const { tmpFb: _a, maxNrMsgs: _b, atLoadTime: _c, ...toExport } = filterFrag
  if (Object.keys(toExport).length === 0) {
    console.log(warning(`exporting filter: ignored empty filter! filter=${JSON.stringify(filterFrag)}`))
    return []
  }
  console.log(green(`exporting filter with keys: '${Object.keys(toExport).join(',')}'`))

  const fragToRet = fragment().ele('filter')
  fragToRet.ele({ type: filterFrag.type ?? 0 })
  fragToRet.ele({ name: filterFrag.name ?? '' }) // todo or use e.g. a name of the rootcause as fallback?
  const ecu = filterFrag.ecu ?? ''
  fragToRet.ele({ ecuid: ecu })
  const apid = filterFrag.apid ?? ''
  fragToRet.ele({ applicationid: apid })
  const ctid = filterFrag.ctid ?? ''
  fragToRet.ele({ contextid: ctid })
  fragToRet.ele({ headertext: '' })

  const payloadtext = filterFrag.payloadRegex ?? filterFrag.payload ?? ''
  fragToRet.ele({ payloadtext: payloadtext })
  fragToRet.ele({ logLevelMax: filterFrag.loglevelMax ?? 0 })
  fragToRet.ele({ logLevelMin: filterFrag.logLevelMin ?? 0 })

  fragToRet.ele({ enablefilter: 'enabled' in filterFrag ? (filterFrag.enabled ? 1 : 0) : 1 })
  fragToRet.ele({ enableecuid: 'ecu' in filterFrag ? 1 : 0 })
  // enableregexp_Ecuid doesn't exist -> export anyhow? ecuIsRegex
  fragToRet.ele({ enableapplicationid: apid.length > 0 ? 1 : 0 })
  fragToRet.ele({ enableregexp_Appid: 'apidIsRegex' in filterFrag ? (filterFrag.apidIsRegex ? 1 : 0) : containsRegexChars(apid) ? 1 : 0 })
  fragToRet.ele({ enablecontextid: ctid.length > 0 ? 1 : 0 })
  fragToRet.ele({ enableregexp_Context: 'ctidIsRegex' in filterFrag ? (filterFrag.ctidIsRegex ? 1 : 0) : containsRegexChars(ctid) ? 1 : 0 })
  fragToRet.ele({ enablepayloadtext: payloadtext.length > 0 ? 1 : 0 })
  fragToRet.ele({ enableregexp_Payload: filterFrag.payloadRegex ? 1 : 0 })
  fragToRet.ele({ ignoreCase_Payload: 'ignoreCasePayload' in filterFrag ? (filterFrag.ignoreCasePayload ? 1 : 0) : 0 })
  fragToRet.ele({ enableLogLevelMax: 'loglevelMax' in filterFrag ? 1 : 0 })
  fragToRet.ele({ enableLogLevelMin: 'logLevelMin' in filterFrag ? 1 : 0 })
  fragToRet.ele({
    enablecontrolmsgs: 'verb_mstp_mtin' in filterFrag ? (((filterFrag.verb_mstp_mtin as number) & 0x03) === 0x03 ? 1 : 0) : 0,
  }) // todo verb_mstp_mtin (pref) or mstp (todo!)
  // todo ...  // filter.verb_mstp_mtin = Some((0x03u8 << 1, (7u8 << 1)));

  // todo add filterColour/marker...

  return [fragToRet]
}
