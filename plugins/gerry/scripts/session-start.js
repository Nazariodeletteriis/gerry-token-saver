'use strict'
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const io = require('./lib/io')
const { detect } = require('./lib/companions')
const { lastResults } = require('./sync')

const MAX_HANDOFF = 60
const MAX_CHARS = 9500
const LARGE_PROJECT_FILES = 20
const SKIP = new Set(['node_modules', 'vendor', 'venv', '__pycache__', 'dist', 'build', 'graphify-out'])
const FIX = {
  graph: 'run `graphify update .` in the project to see the error; if graphify is missing, `pip install graphifyy`; or set graphify to off in /config.',
  obsidian: 'check obsidian_vault in /config.'
}

function handoffBlock (dir) {
  let lines
  try { lines = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf8').split(/\r?\n/) } catch { return { text: '', lines: 0 } }
  const extra = lines.length - MAX_HANDOFF
  const note = extra > 0 ? `\n[... ${extra} more lines: HANDOFF.md will be compacted at the next session-end]` : ''
  return { text: `## HANDOFF.md (${dir})\n${lines.slice(0, MAX_HANDOFF).join('\n')}${note}`, lines: lines.length }
}

function graphExtract (report) {
  const out = []
  let keep = false
  for (const l of report.split(/\r?\n/)) {
    if (l.startsWith('## ')) keep = /^## (Summary|God Nodes)/.test(l)
    if (keep && l.trim()) out.push(l)
  }
  return out.slice(0, 20).join('\n')
}

function graphBlock (dir, mode) {
  if (mode === 'off') return ''
  let report
  try { report = fs.readFileSync(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md'), 'utf8') } catch { return '' }
  return '## Knowledge graph (graphify-out/)\nUse `graphify query "<question>"` before reading raw files to orient yourself.\n' + graphExtract(report)
}

function countFiles (dir, limit) {
  let n = 0
  const stack = [dir]
  while (stack.length && n < limit) {
    const d = stack.pop()
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      if (e.isDirectory()) stack.push(path.join(d, e.name))
      else if (++n >= limit) break
    }
  }
  return n
}

function companionTips (dir, found, mode, large) {
  const tips = []
  if (mode !== 'off' && large && !fs.existsSync(path.join(dir, 'graphify-out'))) {
    if (!found.graphify) tips.push(['graphify', 'This project is large and has no knowledge graph. Suggest once to the user: `pip install graphifyy`, then `/graphify .`.'])
    else if (mode === 'auto') tips.push(['graphify', 'This project has no knowledge graph and the user chose graphify=auto: run `/graphify .` now, before other work.'])
    else tips.push(['graphify', 'This project has no knowledge graph. Suggest once to the user: `/graphify .` builds it.'])
  }
  if (!found.ponytail) tips.push(['ponytail', 'Suggest once to the user: the ponytail plugin keeps code minimal, `/plugin install ponytail@gerry-token-saver`.'])
  return tips
}

function healthAlerts ({ handoffLines, results, nodeMajor }) {
  const alerts = []
  if (nodeMajor < 18) alerts.push(`Node ${nodeMajor} detected, Gerry needs Node >= 18. Fix: update Node.`)
  if (handoffLines > MAX_HANDOFF) alerts.push(`HANDOFF.md is ${handoffLines} lines (limit ${MAX_HANDOFF}). Fix: run session-end when the user wraps up, Gerry compacts it.`)
  for (const r of results) {
    if (!r.ok) alerts.push(`Last ${r.step} sync failed (${r.msg}). Fix: ${FIX[r.step]}`)
  }
  return alerts
}

function briefing (input) {
  const dir = io.projectDir(input)
  const data = io.dataDir()
  const mode = io.option('graphify', 'suggest')
  const lang = io.option('language', 'auto')
  const h = handoffBlock(dir)
  const large = countFiles(dir, LARGE_PROJECT_FILES) >= LARGE_PROJECT_FILES
  const advisedFile = path.join(data, 'advised.json')
  const advised = io.readJson(advisedFile, {})
  const done = new Set(advised[dir] || [])
  const tips = companionTips(dir, detect(io.readJson(io.settingsPath(), {})), mode, large).filter(([name]) => !done.has(name))
  const alerts = healthAlerts({ handoffLines: h.lines, results: lastResults(data, dir), nodeMajor: Number(process.versions.node.split('.')[0]) })
  const parts = [
    lang !== 'auto' ? `Always reply to the user in the language with code "${lang}".` : '',
    h.text,
    graphBlock(dir, mode),
    tips.length ? '## Gerry companions\n' + tips.map(([, t]) => `- ${t}`).join('\n') : '',
    alerts.length ? '## Gerry health: tell the user each problem and its fix\n' + alerts.map(a => `- ${a}`).join('\n') : ''
  ].filter(Boolean)
  if (tips.length) {
    advised[dir] = [...done, ...tips.map(([name]) => name)]
    io.writeJson(advisedFile, advised)
  }
  const text = parts.join('\n\n')
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n[truncated]' : text
}

function startSync (dir) {
  if (process.env.GERRY_NO_SYNC) return
  spawn(process.execPath, [path.join(__dirname, 'sync.js'), dir], { detached: true, stdio: 'ignore' }).unref()
}

function main (input) {
  const text = briefing(input)
  if (text) io.emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
  startSync(io.projectDir(input))
}

if (require.main === module) io.run(main)
module.exports = { handoffBlock, graphExtract, graphBlock, countFiles, companionTips, healthAlerts, briefing, main }
