import { Node, Parent, Literal } from 'unist'
import { visit, CONTINUE, SKIP } from 'unist-util-visit'
import { Html, Root, TableCell, TableRow } from 'mdast'
import { is } from 'unist-util-is'
import { default as JSON5 } from 'json5'
import { version } from './util.js'
import { DltLifecycleInfoMinIF, FbEvent, FbSequenceResult, seqResultToMdAst } from 'dlt-logs-utils/sequence'

// our report type contains the info in a unist compliant AST
// this can then be exported/transformed to markdown, html, junit, etc.

export interface FbaExecReport extends Parent {
  type: 'FbaExecReport'
  data: {
    date: string
    adltVersion: string
    files: string[]
    pluginCfgs: string
    lifecycles: DltLifecycleInfoMinIF[]
    [key: string]: any
  }
  children: FbaResult[]
}

/// results from execution of a single fba file
export interface FbaResult extends Parent {
  type: 'FbaResult'
  data: {
    fbaFileName?: string
    fbaTitle?: string
    errors: string[]
  }
  children: FbEffectResult[]
}

export interface FbEffectResult extends Parent {
  type: 'FbEffectResult'
  data: {
    name?: string
    [key: string]: any
  }
  children: FbCategoryResult[]
}

export interface FbCategoryResult extends Parent {
  type: 'FbCategoryResult'
  data: {
    name?: string
    [key: string]: any
  }
  children: (FbRootCauseResult | FbaResult)[]
}

export interface FbRootCauseResult extends Literal {
  type: 'FbRootCauseResult'
  data: {
    name?: string
    backgroundDescription?: string | { markdownFormat: boolean; textValue: string }
    instructions?: string | { markdownFormat: boolean; textValue: string }
    [key: string]: any
  }
  value: {
    badge?: string | number | FbSequenceResult[]
    badge2?: string | number | FbSequenceResult[]
    events?: FbEvent[]
  }
}

export const hideBadgeValue = (value: string | number | FbSequenceResult[] | undefined): boolean =>
  value === undefined ||
  (typeof value === 'string' && value.length === 0) ||
  (typeof value === 'number' && value === 0) ||
  (Array.isArray(value) && value.length === 0) // or if the occurrence arrays are empty?

export const hideBadge2Value = (value: string | number | FbSequenceResult[] | undefined): boolean => {
  return value === undefined || (typeof value === 'string' && value.length === 0) || (Array.isArray(value) && value.length === 0)
}

export const hideEvents = (events: FbEvent[] | undefined): boolean => {
  return events === undefined || events.length === 0
}

const asTableCell = (text: string | Html): TableCell => {
  return {
    type: 'tableCell',
    children: [typeof text === 'string' ? { type: 'text', value: text } : text],
  }
}

const asTableRow = (cellTexts: (string | Html)[]): TableRow => {
  return {
    type: 'tableRow',
    children: cellTexts.map((text) => asTableCell(text)),
  }
}

const asCollapsable = (summary: string, content: string): Html => {
  return {
    type: 'html',
    value: `<details><summary>${summary}</summary><br>${content}</details>`,
  }
}

const asHtmlTable = (headers: string[], rows: string[]): Html => {
  return {
    type: 'html',
    value: `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r}</tr>`)
      .join('')}</tbody></table>`,
  }
}

const resAsEmoji = (res: string | undefined): string => {
  switch (res) {
    case 'ok':
      return '✅'
    case 'warning':
      return '⚠️'
    case 'error':
      return '❌'
    default:
      return '❓'
  }
}

const numberFormat = new Intl.NumberFormat('de-DE', { style: 'decimal', maximumFractionDigits: 0 })

export function fbReportToMdast(report: FbaExecReport): Root {
  const reportAsMd: Root = {
    type: 'root',
    children: [],
  }
  // now traverse the report and add children
  visit(report, (node: Node) => {
    if (is(node, 'FbRootCauseResult')) {
      const rc = node as FbRootCauseResult
      reportAsMd.children.push({
        type: 'heading',
        depth: 5,
        children: [{ type: 'text', value: `root cause: '${rc.data.name}'` }],
      })
      const badgeValue = rc.value.badge
      if (!hideBadgeValue(badgeValue)) {
        if (typeof badgeValue === 'string' || typeof badgeValue === 'number') {
          reportAsMd.children.push({
            type: 'paragraph',
            children: [
              { type: 'text', value: '🔴: ' }, // or only :warning:?
              { type: 'html', value: '<mark> ' },
              {
                type: 'emphasis',
                children: [
                  { type: 'text', value: "' " },
                  { type: 'text', value: rc.value.badge?.toString() || '' },
                  { type: 'text', value: " '" },
                ],
              },
              { type: 'html', value: ' </mark>' },
            ],
          })
        } else {
          if (Array.isArray(badgeValue)) {
            const seqResults = badgeValue as FbSequenceResult[]
            for (const seqResult of seqResults) {
              const seqAsMd = seqResultToMdAst(seqResult)
              reportAsMd.children.push(...seqAsMd)
            }
          }
        }
      }
      const badge2Value = rc.value.badge2
      if (!hideBadge2Value(badge2Value)) {
        if (typeof badgeValue === 'string' || typeof badgeValue === 'number') {
          reportAsMd.children.push({
            type: 'paragraph',
            children: [
              { type: 'text', value: 'ℹ: ' }, // or emoji :information_source: ?
              { type: 'text', value: rc.value.badge2?.toString() || '' },
            ],
          })
        } else {
          if (Array.isArray(badgeValue)) {
            const seqResults = badgeValue as FbSequenceResult[]
            for (const seqResult of seqResults) {
              const seqAsMd = seqResultToMdAst(seqResult)
              reportAsMd.children.push(...seqAsMd)
            }
          }
        }
      }
      const events = rc.value.events
      if (!hideEvents(events)) {
        const eventChildsAsTableRows: TableRow[] = events
          ? events.map((event, idx) => {
              return asTableRow([
                (idx + 1).toString(),
                event.lifecycle ? event.lifecycle.persistentId.toString() : '', // todo the persistent id is not the one from adlt convert if adlt is started locally and port is used.
                event.timeInMs ? new Date(event.timeInMs).toLocaleString('de-DE') : '<notime>',
                event.evType,
                event.title,
                event.summary || '',
                event.msgText || '',
              ])
            })
          : []
        reportAsMd.children.push({
          type: 'paragraph',
          children: [
            { type: 'html', value: `<details>` },
            { type: 'html', value: `<summary>` },
            { type: 'text', value: `Events: ${events?.length}` },
            { type: 'html', value: `</summary><br>` },
          ],
        })
        reportAsMd.children.push({
          type: 'table',
          align: ['right', 'left', 'left', 'left', 'left', 'left', 'left'],
          children: [
            asTableRow([
              '#',
              'LC',
              `Time (${
                Intl.DateTimeFormat('de-DE', { timeZoneName: 'longOffset' })
                  .formatToParts(
                    events && events.length > 0 && events[0].timeInMs !== undefined ? new Date(events[0].timeInMs) : Date.now(),
                  )
                  .find((part) => part.type === 'timeZoneName')?.value || 'UTC'
              })`,
              'Event type',
              'Title',
              'Summary',
              'Details',
            ]),
            ...eventChildsAsTableRows,
          ],
        })
        reportAsMd.children.push({
          type: 'paragraph',
          children: [{ type: 'html', value: `</details>` }],
        })
      }
      // add backgroundDescription
      if (rc.data.backgroundDescription) {
        reportAsMd.children.push({
          type: 'paragraph',
          children: [
            { type: 'html', value: `<details>` }, // +' open' if it shall be open by default
            { type: 'html', value: `<summary>` },
            { type: 'text', value: `background:` },
            { type: 'html', value: `</summary><br>` },
            {
              type: 'text',
              value:
                typeof rc.data.backgroundDescription === 'string' ? rc.data.backgroundDescription : rc.data.backgroundDescription.textValue, // todo embed markdown, rewrite headings to higher level...
            },
            { type: 'html', value: `</details>` }, // or as 2nd paragraph?
          ],
        })
      }
      return CONTINUE
    }
    if (is(node, 'FbCategoryResult')) {
      const rc = node as FbCategoryResult
      reportAsMd.children.push({
        type: 'heading',
        depth: 4,
        children: [{ type: 'text', value: `category: '${rc.data.name}'` }],
      })
      reportAsMd.children.push({
        type: 'paragraph',
        children: [],
      })
      return CONTINUE
    }

    if (is(node, 'FbEffectResult')) {
      const rc = node as FbEffectResult
      reportAsMd.children.push({
        type: 'heading',
        depth: 3,
        children: [{ type: 'text', value: `effect: '${rc.data.name}'` }],
      })
      reportAsMd.children.push({
        type: 'paragraph',
        children: [],
      })
      return CONTINUE
    }
    if (is(node, 'FbaResult')) {
      const rc = node as FbaResult
      const isEmbedded = !rc.data.fbaFileName
      reportAsMd.children.push({
        type: 'heading',
        depth: isEmbedded ? 3 : 2,
        children: [{ type: 'text', value: `${isEmbedded ? 'embedded ' : ''}fishbone: '${rc.data.fbaTitle}'` }],
      })
      if (rc.data.errors.length) {
        reportAsMd.children.push({
          type: 'paragraph',
          children: [
            { type: 'text', value: `❌ ` },
            {
              type: 'emphasis',
              children: rc.data.errors.map((e) => {
                return { type: 'text', value: e }
              }),
            },
          ],
        })
      }
      if (rc.data.fbaFileName) {
        reportAsMd.children.push({
          type: 'paragraph',
          children: [{ type: 'text', value: `file: ${rc.data.fbaFileName}` }],
        })
      }
      return CONTINUE
    }
    if (is(node, 'FbaExecReport')) {
      const rc = node as FbaExecReport
      reportAsMd.children.push({
        type: 'heading',
        depth: 1,
        children: [{ type: 'text', value: `fba-cli execution report` }], // rc.children,
      })
      // output some data:
      reportAsMd.children.push({
        type: 'paragraph',
        children: [
          { type: 'text', value: `date: ${rc.data.date}, ` },
          { type: 'text', value: `adlt v${rc.data.adltVersion}, fba-cli v${version()} ` },
          { type: 'break' },
          { type: 'text', value: `files: ${rc.data.files.join(', ')}` },
          { type: 'break' },
          { type: 'html', value: `<details>` },
          { type: 'html', value: `<summary>` },
          { type: 'text', value: `pluginCfgs used:` },
          { type: 'html', value: `</summary><br>` },
        ],
      })
      reportAsMd.children.push({
        type: 'code',
        lang: 'json',
        value: JSON.stringify(JSON5.parse(rc.data.pluginCfgs), undefined, 2),
      })
      reportAsMd.children.push(
        { type: 'html', value: `</details>` }, // or as 2nd paragraph?
      )
      reportAsMd.children.push({ type: 'thematicBreak' })

      const ecuNrMsgs = Array.from(
        rc.data.lifecycles.reduce((map, lc) => {
          const curMsg = map.get(lc.ecu)
          if (curMsg) {
            map.set(lc.ecu, curMsg + lc.nrMsgs)
          } else {
            map.set(lc.ecu, lc.nrMsgs)
          }
          return map
        }, new Map<string, number>()),
      ).sort((a, b) => b[1] - a[1])
      const nrMsgsProcessed = ecuNrMsgs.reduce((acc, ecuNrMsgs) => acc + ecuNrMsgs[1], 0)
      reportAsMd.children.push({
        type: 'paragraph',
        children: [
          {
            type: 'text',
            value:
              ecuNrMsgs.length === 1
                ? `Processed ${numberFormat.format(nrMsgsProcessed)} messages from ECU: '${ecuNrMsgs[0][0]}'.`
                : `Processed ${numberFormat.format(nrMsgsProcessed)} messages from ${ecuNrMsgs.length} ECUs: ${ecuNrMsgs
                    .map(([ecu, nrMsgs]) => `'${ecu}' (${numberFormat.format(nrMsgs)})`)
                    .join(', ')}.`,
          },
        ],
      })
      // add lifecycle infos:
      reportAsMd.children.push({
        type: 'paragraph',
        children: [
          { type: 'html', value: `<details>` },
          { type: 'html', value: `<summary>` },
          { type: 'text', value: `Lifecycles: ${rc.data.lifecycles.length}` },
          { type: 'html', value: `</summary><br>` },
        ],
      })
      if (rc.data.lifecycles.length) {
        const lifecycles = rc.data.lifecycles
        const lcsAsTableRows: TableRow[] = lifecycles.map((lc, idx) => {
          return asTableRow([
            lc.persistentId.toString(),
            lc.ecu,
            lc.isResume && lc.lifecycleResume !== undefined
              ? lc.lifecycleResume.toLocaleString('de-DE')
              : lc.lifecycleStart.toLocaleString('de-DE'),
            lc.lifecycleEnd.toLocaleTimeString('de-DE'),
            lc.isResume ? 'RESUME' : '',
            numberFormat.format(lc.nrMsgs),
            lc.swVersions.join(', ') || '',
          ])
        })
        reportAsMd.children.push({
          type: 'table',
          align: ['right', 'left', 'left', 'left', 'left', 'right', 'left'],
          children: [
            asTableRow([
              '#',
              'ECU',
              `Start time (${
                Intl.DateTimeFormat('de-DE', { timeZoneName: 'longOffset' })
                  .formatToParts(lifecycles[0].lifecycleStart)
                  .find((part) => part.type === 'timeZoneName')?.value || 'UTC'
              })`,
              'End time',
              'Resume?',
              'nr msgs',
              'SW',
            ]),
            ...lcsAsTableRows,
          ],
        })
      }
      reportAsMd.children.push({
        type: 'paragraph',
        children: [{ type: 'html', value: `</details>` }],
      })
      reportAsMd.children.push({ type: 'thematicBreak' })

      return CONTINUE // traverse children as well SKIP // dont traverse children
    }
    console.log(`skipping children of node.type=${node.type}`)
    return SKIP // if we reach here we dont know the node!
  })
  return reportAsMd
}
