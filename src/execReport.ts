import { Node, Parent, Literal } from 'unist'
import { visit, CONTINUE, SKIP, EXIT } from 'unist-util-visit'
import { Root } from 'mdast'
import { is } from 'unist-util-is'
import { default as JSON5 } from 'json5'

// our report type contains the info in a unist compliant AST
// this can then be exported/transformed to markdown, html, junit, etc.

export interface FbaExecReport extends Parent {
  type: 'FbaExecReport'
  data: {
    date: string
    adltVersion: string
    files: string[]
    pluginCfgs: string
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
    badge?: string | number
    badge2?: string | number
  }
}

export const hideBadgeValue = (value: string | number | undefined): boolean =>
  value === undefined || (typeof value === 'string' && value.length === 0) || (typeof value === 'number' && value === 0)

export const hideBadge2Value = (value: string | number | undefined): boolean => {
  return value === undefined || (typeof value === 'string' && value.length === 0)
}

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
        reportAsMd.children.push({
          type: 'paragraph',
          children: [
            { type: 'text', value: '🔴: ' }, // or only :warning:?
            { type: 'html', value: '<mark>' },
            { type: 'emphasis', children: [{ type: 'text', value: rc.value.badge?.toString() || '' }] },
            { type: 'html', value: '</mark>' },
          ],
        })
      }
      const badge2Value = rc.value.badge2
      if (!hideBadge2Value(badge2Value)) {
        reportAsMd.children.push({
          type: 'paragraph',
          children: [
            { type: 'text', value: 'ℹ: ' }, // or emoji :information_source: ?
            { type: 'text', value: rc.value.badge2?.toString() || '' },
          ],
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
          { type: 'text', value: `date: ${rc.data.date} ` },
          { type: 'text', value: `adltVersion: ${rc.data.adltVersion}` },
          { type: 'break' },
          { type: 'text', value: `files: ${rc.data.files.join(', ')}` },
          { type: 'break' },
          { type: 'html', value: `<details>` },
          { type: 'html', value: `<summary>` },
          { type: 'text', value: `pluginCfgs:` },
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
      return CONTINUE // traverse children as well SKIP // dont traverse children
    }
    console.log(`skipping children of node.type=${node.type}`)
    return SKIP // if we reach here we dont know the node!
  })
  return reportAsMd
}
