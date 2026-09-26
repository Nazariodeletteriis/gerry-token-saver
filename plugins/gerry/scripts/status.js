'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const io = require('./lib/io')
const { tailRecords, contextTokens, sessionTokens } = require('./lib/transcript')
const { contextWindow, usage } = require('./context')
const { detect, which, runCmd } = require('./lib/companions')
const { lastResults } = require('./sync')
const { healthAlerts, handoffBlock } = require('./session-start')

function transcriptFor (dir, home = os.homedir()) {
  const p = path.join(home, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'))
  let files
  try { files = fs.readdirSync(p).filter(f => f.endsWith('.jsonl')) } catch { return null }
  const newest = files.map(f => path.join(p, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  return newest || null
}

function ymd (d) {
  return d.toLocaleDateString('sv')
}

function ccusageDaily () {
  const since = ymd(new Date(Date.now() - 6 * 86400000)).replace(/-/g, '')
  const bin = which('ccusage')
  const npx = which('npx')
  if (!bin && !npx) return null
  const [cmd, pre] = bin ? [bin, []] : [npx, ['-y', 'ccusage@latest']]
  const r = runCmd(cmd, [...pre, 'daily', '--json', '--since', since], process.cwd(), 120000)
  try { return r.ok ? JSON.parse(r.out).daily : null } catch { return null }
}

function summarize (daily, today) {
  const t = daily.find(d => d.period === today)
  const sum = k => daily.reduce((a, d) => a + (d[k] || 0), 0)
  return { today: t ? { tokens: t.totalTokens, cost: t.totalCost } : null, week: { tokens: sum('totalTokens'), cost: sum('totalCost') } }
}

function fmt (n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
}

function formatStatus (s) {
  const money = x => x ? `${fmt(x.tokens)} tokens · $${x.cost.toFixed(2)}` : 'no data'
  const mark = b => (b ? '✓' : '✗')
  const c = s.companions
  return [
    `## Gerry status — ${s.dir}`,
    `- Context: ${s.ctx ? `${s.ctx.used}% used (${s.ctx.remaining}% left)` : 'no transcript found'}`,
    `- This session: ${fmt(s.sessionTokens || 0)} tokens (cache included)`,
    s.usage ? `- Today: ${money(s.usage.today)}\n- Last 7 days: ${money(s.usage.week)}` : '- Usage: ccusage not available (`npm i -g ccusage`)',
    `- Companions: graphify ${mark(c.graphify)} · ponytail ${mark(c.ponytail)} · headroom ${mark(c.headroom)} · ccusage ${mark(c.ccusage)} · fast-jev ${mark(c.fastJev)}`,
    `- Last sync: ${s.results.length ? s.results.map(r => `${r.step} ${r.ok ? 'ok' : 'failed: ' + r.msg} (${r.ts})`).join(' · ') : 'never'}`,
    `- Health: ${s.alerts.length ? '\n' + s.alerts.map(a => `  - ${a}`).join('\n') : 'ok'}`
  ].join('\n')
}

function main () {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const tr = transcriptFor(dir)
  const recs = tr ? tailRecords(tr, Infinity) : []
  const tokens = contextTokens(recs)
  const results = lastResults(io.dataDir(), dir)
  const daily = ccusageDaily()
  console.log(formatStatus({
    dir,
    ctx: tokens === null ? null : usage(tokens, contextWindow(io.option('context_window', 'auto'), io.settingsPath(), tokens)),
    sessionTokens: sessionTokens(recs),
    usage: daily ? summarize(daily, ymd(new Date())) : null,
    companions: detect(io.readJson(io.settingsPath(), {})),
    results,
    alerts: healthAlerts({ handoffLines: handoffBlock(dir).lines, results, nodeMajor: Number(process.versions.node.split('.')[0]) })
  }))
}

if (require.main === module) {
  try { main() } catch (e) { console.log(`Gerry status failed: ${e.message}`) }
}
module.exports = { transcriptFor, summarize, formatStatus }
