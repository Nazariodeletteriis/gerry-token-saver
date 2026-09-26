'use strict'
const path = require('path')
const io = require('./lib/io')
const { tailRecords, contextTokens } = require('./lib/transcript')

const WARN_USED = 60
const CRITICAL_REMAINING = 30
const COMPACT_BUFFER = 10

function contextWindow (opt, settingsFile) {
  if (process.env.GERRY_CTX_LIMIT) return Number(process.env.GERRY_CTX_LIMIT)
  if (opt === '200000' || opt === '1000000') return Number(opt)
  const model = String(io.readJson(settingsFile, {}).model || '')
  return model.includes('[1m]') ? 1000000 : 200000
}

function usage (tokens, window) {
  const raw = Math.max(0, (1 - tokens / window) * 100)
  const remaining = Math.round(Math.max(0, (raw - COMPACT_BUFFER) / (100 - COMPACT_BUFFER) * 100))
  return { used: 100 - remaining, remaining }
}

function decide (u, state) {
  if (u.remaining <= CRITICAL_REMAINING && !state.critical) return 'critical'
  if (u.used >= WARN_USED && !state.warned && !state.critical) return 'warn'
  return null
}

function main (input) {
  if (!input.transcript_path) return
  const tokens = contextTokens(tailRecords(input.transcript_path, 512 * 1024))
  if (tokens === null) return
  const u = usage(tokens, contextWindow(io.option('context_window', 'auto'), io.settingsPath()))
  const file = path.join(io.dataDir(), 'sessions', `${input.session_id || 'default'}.json`)
  const state = io.readJson(file, {})
  const level = decide(u, state)
  if (!level) return
  state.warned = true
  if (level === 'critical') state.critical = true
  io.writeJson(file, state)
  const dir = io.projectDir(input)
  const text = level === 'warn'
    ? `Gerry: context at ${u.used}% (${u.remaining}% left). Tell the user in one line: when the current task is done, it is worth closing this session.`
    : `Gerry CRITICAL: context at ${u.used}% (${u.remaining}% left). Write a real summary of this session, dispatch the gerry:gerry agent with "session-end: ${dir} | <summary>", then suggest the user opens a new session.`
  io.emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })
}

if (require.main === module) io.run(main)
module.exports = { contextWindow, usage, decide, main }
