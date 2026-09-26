'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, writeTranscript, assistant, runScript } = require('./helpers')
const c = require('../plugins/gerry/scripts/context')

test('usage maps tokens to usable percentages', () => {
  assert.deepStrictEqual(c.usage(90000, 200000), { used: 50, remaining: 50 })
  assert.deepStrictEqual(c.usage(110000, 200000), { used: 61, remaining: 39 })
  assert.deepStrictEqual(c.usage(135000, 200000), { used: 75, remaining: 25 })
  assert.deepStrictEqual(c.usage(500000, 200000), { used: 100, remaining: 0 })
})

test('decide fires each threshold once, critical wins', () => {
  assert.strictEqual(c.decide({ used: 50, remaining: 50 }, {}), null)
  assert.strictEqual(c.decide({ used: 61, remaining: 39 }, {}), 'warn')
  assert.strictEqual(c.decide({ used: 61, remaining: 39 }, { warned: true }), null)
  assert.strictEqual(c.decide({ used: 75, remaining: 25 }, { warned: true }), 'critical')
  assert.strictEqual(c.decide({ used: 75, remaining: 25 }, { critical: true, warned: true }), null)
})

test('contextWindow: option, then [1m] in settings, then 200k', () => {
  const d = tmp()
  const s = path.join(d, 'settings.json')
  fs.writeFileSync(s, JSON.stringify({ model: 'opus[1m]' }))
  assert.strictEqual(c.contextWindow('auto', s), 1000000)
  assert.strictEqual(c.contextWindow('200000', s), 200000)
  fs.writeFileSync(s, JSON.stringify({ model: 'sonnet' }))
  assert.strictEqual(c.contextWindow('auto', s), 200000)
  assert.strictEqual(c.contextWindow('auto', path.join(d, 'missing.json')), 200000)
})

function env (d) {
  return { CLAUDE_PLUGIN_DATA: path.join(d, 'data'), CLAUDE_PLUGIN_OPTION_CONTEXT_WINDOW: '200000', GERRY_CTX_LIMIT: '' }
}

test('hook is silent below threshold', () => {
  const d = tmp()
  const tr = writeTranscript(path.join(d, 't.jsonl'), [assistant({ tokens: 90000 })])
  const r = runScript('context.js', { session_id: 's1', transcript_path: tr, cwd: d }, env(d))
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.out, null)
})

test('hook warns once, then goes critical once', () => {
  const d = tmp()
  const tr = path.join(d, 't.jsonl')
  const input = { session_id: 's2', transcript_path: tr, cwd: d }
  writeTranscript(tr, [assistant({ tokens: 110000 })])
  const first = runScript('context.js', input, env(d))
  assert.match(first.out.hookSpecificOutput.additionalContext, /context at 61%/)
  assert.strictEqual(first.out.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.strictEqual(runScript('context.js', input, env(d)).out, null)
  writeTranscript(tr, [assistant({ tokens: 135000 })])
  const crit = runScript('context.js', input, env(d))
  assert.match(crit.out.hookSpecificOutput.additionalContext, /CRITICAL.*gerry:gerry.*session-end/s)
  assert.strictEqual(runScript('context.js', input, env(d)).out, null)
})

test('corrupt session state is treated as empty', () => {
  const d = tmp()
  const e = env(d)
  fs.mkdirSync(path.join(e.CLAUDE_PLUGIN_DATA, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(e.CLAUDE_PLUGIN_DATA, 'sessions', 's3.json'), '{"warn')
  const tr = writeTranscript(path.join(d, 't.jsonl'), [assistant({ tokens: 110000 })])
  const r = runScript('context.js', { session_id: 's3', transcript_path: tr, cwd: d }, e)
  assert.match(r.out.hookSpecificOutput.additionalContext, /context at 61%/)
})

test('missing transcript exits 0 with no output', () => {
  const d = tmp()
  const r = runScript('context.js', { session_id: 's4', transcript_path: path.join(d, 'nope.jsonl') }, env(d))
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.raw, '')
})
