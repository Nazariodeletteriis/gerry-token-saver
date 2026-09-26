'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, runScript } = require('./helpers')
const ss = require('../plugins/gerry/scripts/session-start')

const REPORT = [
  '# Graph Report - .  (2026-09-23)', '', '## Corpus Check', '- 185 files', '',
  '## Summary', '- 2495 nodes · 6548 edges', '', '## Community Hubs (Navigation)', '- [[x]]', '',
  '## God Nodes (most connected - your core abstractions)', '1. `Rapportino` - 282 edges', '2. `entra()` - 252 edges', '',
  '## Surprising Connections', '- a'
].join('\n')

test('handoffBlock keeps 60 lines of a CRLF file and notes the rest', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), Array.from({ length: 112 }, (_, i) => `line ${i + 1}`).join('\r\n'))
  const h = ss.handoffBlock(d)
  assert.strictEqual(h.lines, 112)
  assert.match(h.text, /line 60\n/)
  assert.doesNotMatch(h.text, /line 61\b/)
  assert.doesNotMatch(h.text, /\r/)
  assert.match(h.text, /52 more lines/)
})

test('handoffBlock on a missing file is empty', () => {
  assert.deepStrictEqual(ss.handoffBlock(tmp()), { text: '', lines: 0 })
})

test('graphExtract keeps Summary and God Nodes only', () => {
  const x = ss.graphExtract(REPORT)
  assert.match(x, /2495 nodes/)
  assert.match(x, /Rapportino/)
  assert.doesNotMatch(x, /Corpus Check|Community Hubs|Surprising/)
})

test('countFiles stops at the limit and skips node_modules and dot dirs', () => {
  const d = tmp()
  fs.mkdirSync(path.join(d, 'node_modules'))
  fs.mkdirSync(path.join(d, '.git'))
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(d, 'node_modules', `m${i}.js`), '')
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(d, '.git', `g${i}`), '')
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, `f${i}.js`), '')
  assert.strictEqual(ss.countFiles(d, 20), 5)
  for (let i = 5; i < 40; i++) fs.writeFileSync(path.join(d, `f${i}.js`), '')
  assert.strictEqual(ss.countFiles(d, 20), 20)
})

test('companionTips: graphify missing / suggest / auto, ponytail missing', () => {
  const d = tmp()
  const none = { graphify: false, ponytail: false }
  assert.match(ss.companionTips(d, none, 'suggest', true).find(t => t[0] === 'graphify')[1], /pip install graphifyy/)
  assert.match(ss.companionTips(d, { graphify: true, ponytail: true }, 'auto', true)[0][1], /run `\/graphify \.` now/)
  assert.strictEqual(ss.companionTips(d, { graphify: true, ponytail: true }, 'suggest', false).length, 0)
  assert.strictEqual(ss.companionTips(d, none, 'off', true).find(t => t[0] === 'graphify'), undefined)
  assert.ok(ss.companionTips(d, none, 'off', false).find(t => t[0] === 'ponytail'))
})

test('healthAlerts: silent when ok, problem + fix otherwise', () => {
  assert.deepStrictEqual(ss.healthAlerts({ handoffLines: 40, results: [{ step: 'graph', ok: true }], nodeMajor: 22 }), [])
  const a = ss.healthAlerts({
    handoffLines: 112,
    results: [{ step: 'graph', ok: false, msg: 'graphify not found in PATH' }, { step: 'obsidian', ok: false, msg: 'vault not found: /x' }],
    nodeMajor: 16
  })
  assert.strictEqual(a.length, 4)
  assert.ok(a.every(x => /Fix:/.test(x)))
})

function env (d, extra = {}) {
  return { CLAUDE_PLUGIN_DATA: path.join(d, 'data'), CLAUDE_PLUGIN_OPTION_LANGUAGE: 'it', GERRY_SETTINGS: path.join(d, 'settings.json'), PATH: '', ...extra }
}

test('hook injects language, HANDOFF, graph; companions advised once; < 10k chars', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), '# HANDOFF — demo\n## Dove siamo\n- punto')
  fs.mkdirSync(path.join(d, 'graphify-out'))
  fs.writeFileSync(path.join(d, 'graphify-out', 'GRAPH_REPORT.md'), REPORT)
  const first = runScript('session-start.js', { cwd: d, source: 'startup' }, env(d))
  const ctx = first.out.hookSpecificOutput.additionalContext
  assert.strictEqual(first.out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.match(ctx, /code "it"/)
  assert.match(ctx, /HANDOFF — demo/)
  assert.match(ctx, /Rapportino/)
  assert.match(ctx, /ponytail/)
  assert.ok(ctx.length < 10000)
  const second = runScript('session-start.js', { cwd: d, source: 'startup' }, env(d))
  assert.doesNotMatch(second.out.hookSpecificOutput.additionalContext, /ponytail/)
})

test('hook truncates a huge briefing under 10k chars', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'HANDOFF.md'), Array.from({ length: 60 }, () => 'x'.repeat(400)).join('\n'))
  const r = runScript('session-start.js', { cwd: d }, env(d))
  assert.ok(r.out.hookSpecificOutput.additionalContext.length <= 9500 + 20)
})

test('hook with nothing to say emits nothing', () => {
  const d = tmp()
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@gerry-token-saver': true } }))
  const r = runScript('session-start.js', { cwd: d }, env(d, { CLAUDE_PLUGIN_OPTION_LANGUAGE: 'auto' }))
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.raw, '')
})
