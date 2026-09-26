'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, writeTranscript, assistant } = require('./helpers')
const t = require('../plugins/gerry/scripts/lib/transcript')

test('contextTokens uses the last main-chain usage, ignoring sidechains', () => {
  const recs = [assistant({ tokens: 1000 }), assistant({ tokens: 5000 }), assistant({ tokens: 99999, sidechain: true })]
  assert.strictEqual(t.contextTokens(recs), 5000)
  assert.strictEqual(t.contextTokens([{ type: 'user' }]), null)
})

test('tailRecords drops the truncated first line and bad lines', () => {
  const d = tmp()
  const f = path.join(d, 't.jsonl')
  fs.writeFileSync(f, JSON.stringify({ n: 1 }) + '\nnot json\n' + JSON.stringify({ n: 2 }) + '\n')
  assert.deepStrictEqual(t.tailRecords(f).map(r => r.n), [1, 2])
  assert.deepStrictEqual(t.tailRecords(f, 12).map(r => r.n), [2])
})

test('tailRecords survives a single line longer than the window', () => {
  const f = path.join(tmp(), 'big.jsonl')
  fs.writeFileSync(f, JSON.stringify({ img: 'x'.repeat(200000) }) + '\n')
  assert.deepStrictEqual(t.tailRecords(f, 1000), [])
})

test('lastEditMs returns the latest edit and ignores HANDOFF files', () => {
  const recs = [
    assistant({ tools: [['Edit', '/p/a.js']], ts: '2026-09-26T10:00:00.000Z' }),
    assistant({ tools: [['Write', '/p/HANDOFF.md']], ts: '2026-09-26T12:00:00.000Z' }),
    assistant({ tools: [['Read', '/p/b.js']], ts: '2026-09-26T13:00:00.000Z' }),
    assistant({ tools: [['Write', '/p/c.js']], ts: '2026-09-26T11:00:00.000Z' })
  ]
  assert.strictEqual(t.lastEditMs(recs, ['/p/HANDOFF.md']), Date.parse('2026-09-26T11:00:00.000Z'))
  assert.strictEqual(t.lastEditMs([assistant({})], []), null)
})

test('sessionTokens counts each message id once', () => {
  const a = assistant({ tokens: 100, id: 'm1' })
  const recs = [a, a, assistant({ tokens: 50, id: 'm2' })]
  assert.strictEqual(t.sessionTokens(recs), 100 + 10 + 50 + 10)
})

test('tailRecords reads a real file end to end', () => {
  const f = writeTranscript(path.join(tmp(), 'r.jsonl'), [assistant({ tokens: 7 })])
  assert.strictEqual(t.contextTokens(t.tailRecords(f)), 7)
})
