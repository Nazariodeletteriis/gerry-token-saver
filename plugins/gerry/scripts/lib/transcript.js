'use strict'
const fs = require('fs')
const path = require('path')

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

function tailRecords (file, bytes = 4 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const from = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - from)
    fs.readSync(fd, buf, 0, buf.length, from)
    const lines = buf.toString('utf8').split('\n')
    if (from > 0) lines.shift()
    const out = []
    for (const l of lines) {
      if (!l) continue
      try { out.push(JSON.parse(l)) } catch {}
    }
    return out
  } finally {
    fs.closeSync(fd)
  }
}

function usageOf (r) {
  return !r.isSidechain && r.message && r.message.usage
}

function contextTokens (records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const u = usageOf(records[i])
    if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
  return null
}

function lastEditMs (records, ignore) {
  const skip = new Set(ignore.map(p => path.resolve(p)))
  let last = null
  for (const r of records) {
    if (r.type !== 'assistant' || r.isSidechain || !Array.isArray(r.message && r.message.content)) continue
    for (const c of r.message.content) {
      if (c.type !== 'tool_use' || !EDIT_TOOLS.has(c.name)) continue
      const p = c.input && (c.input.file_path || c.input.notebook_path)
      if (!p || skip.has(path.resolve(p))) continue
      const ms = Date.parse(r.timestamp)
      if (!Number.isNaN(ms) && (last === null || ms > last)) last = ms
    }
  }
  return last
}

function sessionTokens (records) {
  const seen = new Set()
  let sum = 0
  for (const r of records) {
    const u = r.type === 'assistant' && usageOf(r)
    if (!u || seen.has(r.message.id)) continue
    seen.add(r.message.id)
    sum += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
  return sum
}

module.exports = { tailRecords, contextTokens, lastEditMs, sessionTokens }
