'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function which (cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext)
      try { if (fs.statSync(p).isFile()) return p } catch {}
    }
  }
  return null
}

function pluginEnabled (settings, name) {
  return Object.entries(settings.enabledPlugins || {}).some(([k, v]) => v === true && k.startsWith(name + '@'))
}

function detect (settings) {
  return {
    graphify: !!which('graphify'),
    ponytail: pluginEnabled(settings, 'ponytail'),
    ccusage: !!which('ccusage'),
    fastJev: pluginEnabled(settings, 'fast-jev-compaction'),
    headroom: !!which('headroom') && /127\.0\.0\.1|localhost/.test(process.env.ANTHROPIC_BASE_URL || '')
  }
}

function runCmd (cmd, args, cwd, timeout) {
  const win = process.platform === 'win32' // .cmd shims need a shell; quote the path in case it has spaces
  const r = spawnSync(win ? `"${cmd}"` : cmd, args, { cwd, timeout, encoding: 'utf8', shell: win, windowsHide: true })
  return { ok: r.status === 0, out: r.stdout || '', err: String(r.stderr || (r.error && r.error.message) || '').trim() }
}

module.exports = { which, pluginEnabled, detect, runCmd }
