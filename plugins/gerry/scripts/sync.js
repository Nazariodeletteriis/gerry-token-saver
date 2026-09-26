'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const io = require('./lib/io')
const { which, runCmd } = require('./lib/companions')

const LOCK_STALE_MS = 10 * 60 * 1000
const LOG_MAX_BYTES = 200 * 1024

function lock (data, dir) {
  const f = path.join(data, 'locks', crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12) + '.lock')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  try {
    fs.closeSync(fs.openSync(f, 'wx'))
    return f
  } catch {
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(f, { force: true })
        return lock(data, dir)
      }
    } catch {}
    return null
  }
}

function log (data, entry) {
  const f = path.join(data, 'sync-log.jsonl')
  fs.appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  if (fs.statSync(f).size > LOG_MAX_BYTES) {
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').trim().split('\n').slice(-200).join('\n') + '\n')
  }
}

function lastResults (data, dir) {
  let lines = []
  try { lines = fs.readFileSync(path.join(data, 'sync-log.jsonl'), 'utf8').trim().split('\n') } catch {}
  const last = {}
  for (const l of lines) {
    try {
      const e = JSON.parse(l)
      if (e.project === dir) last[e.step] = { step: e.step, ok: e.ok, msg: e.msg, ts: e.ts }
    } catch {}
  }
  return Object.values(last)
}

function newer (src, dst) {
  try {
    return fs.statSync(src).mtimeMs > (fs.existsSync(dst) ? fs.statSync(dst).mtimeMs : 0)
  } catch { return false }
}

function syncGraph (dir) {
  if (!fs.existsSync(path.join(dir, 'graphify-out', 'graph.json'))) return null
  const bin = which('graphify')
  if (!bin) return { ok: false, msg: 'graphify not found in PATH' }
  const r = runCmd(bin, ['update', '.'], dir, 5 * 60 * 1000)
  return { ok: r.ok, msg: r.ok ? 'updated' : r.err.slice(0, 300) || 'graphify update failed' }
}

function syncObsidian (dir, vault) {
  if (!vault) return null
  if (!fs.existsSync(vault)) return { ok: false, msg: `vault not found: ${vault}` }
  const dest = path.join(vault, path.basename(dir))
  const handoff = path.join(dir, 'HANDOFF.md')
  if (newer(handoff, path.join(dest, 'HANDOFF.md'))) {
    fs.mkdirSync(dest, { recursive: true })
    fs.copyFileSync(handoff, path.join(dest, 'HANDOFF.md'))
  }
  const report = path.join(dir, 'graphify-out', 'GRAPH_REPORT.md')
  if (newer(report, path.join(dest, 'graph', 'GRAPH_REPORT.md'))) {
    const obs = path.join(dir, 'graphify-out', 'obsidian')
    if (fs.existsSync(obs)) fs.cpSync(obs, path.join(dest, 'graph'), { recursive: true })
    fs.mkdirSync(path.join(dest, 'graph'), { recursive: true })
    fs.copyFileSync(report, path.join(dest, 'graph', 'GRAPH_REPORT.md'))
  }
  return { ok: true, msg: 'synced' }
}

function step (fn) {
  try { return fn() } catch (e) { return { ok: false, msg: e.message } }
}

function sync (dir, opts, data) {
  const held = lock(data, dir)
  if (!held) return
  try {
    const results = {
      graph: opts.graphify === 'off' ? null : step(() => syncGraph(dir)),
      obsidian: step(() => syncObsidian(dir, opts.vault))
    }
    for (const [name, res] of Object.entries(results)) {
      if (res) log(data, { project: dir, step: name, ...res })
    }
  } finally {
    fs.rmSync(held, { force: true })
  }
}

function main (input) {
  const dir = process.argv[2] || io.projectDir(input)
  sync(dir, { graphify: io.option('graphify', 'suggest'), vault: io.option('obsidian_vault', '') }, io.dataDir())
}

if (require.main === module) io.run(main)
module.exports = { sync, lastResults }
