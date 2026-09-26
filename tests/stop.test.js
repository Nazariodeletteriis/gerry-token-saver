'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, writeTranscript, assistant, runScript } = require('./helpers')

function setup ({ handoff = true, editMinutesAfterHandoff = 5 } = {}) {
  const d = tmp() // not a git repo on purpose
  const handoffPath = path.join(d, 'HANDOFF.md')
  if (handoff) {
    fs.writeFileSync(handoffPath, '# HANDOFF\n')
    const past = new Date(Date.now() - 60 * 60 * 1000)
    fs.utimesSync(handoffPath, past, past)
  }
  const editAt = new Date(Date.now() - 60 * 60 * 1000 + editMinutesAfterHandoff * 60 * 1000).toISOString()
  const tr = writeTranscript(path.join(d, 't.jsonl'), [assistant({ tools: [['Edit', path.join(d, 'app.js')]], ts: editAt })])
  const env = { CLAUDE_PLUGIN_DATA: path.join(d, 'data'), CLAUDE_PLUGIN_OPTION_LANGUAGE: 'it' }
  return { d, input: { transcript_path: tr, cwd: d }, env }
}

test('edit after HANDOFF in a non-git dir -> one systemMessage, then cooldown', () => {
  const { input, env } = setup()
  const r = runScript('stop.js', input, env)
  assert.strictEqual(r.status, 0)
  assert.match(r.out.systemMessage, /HANDOFF/)
  assert.strictEqual(r.out.hookSpecificOutput, undefined)
  assert.strictEqual(r.out.decision, undefined)
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('HANDOFF updated after the last edit -> silent', () => {
  const { input, env } = setup({ editMinutesAfterHandoff: -5 })
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('no HANDOFF.md -> silent', () => {
  const { input, env } = setup({ handoff: false })
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('no edits in transcript -> silent', () => {
  const { d, input, env } = setup()
  writeTranscript(input.transcript_path, [assistant({ tools: [['Read', path.join(d, 'app.js')]] })])
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('english message when language is auto', () => {
  const { input, env } = setup()
  env.CLAUDE_PLUGIN_OPTION_LANGUAGE = 'auto'
  assert.match(runScript('stop.js', input, env).out.systemMessage, /files changed/)
})
