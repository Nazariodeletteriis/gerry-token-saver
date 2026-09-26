'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp } = require('./helpers')
const st = require('../plugins/gerry/scripts/status')

test('transcriptFor picks the newest jsonl of the project slug', () => {
  const home = tmp()
  const dir = '/var/www/Claude_code_agents/Gerry'
  const p = path.join(home, '.claude', 'projects', '-var-www-Claude-code-agents-Gerry')
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, 'old.jsonl'), '')
  fs.writeFileSync(path.join(p, 'new.jsonl'), '')
  const past = new Date(Date.now() - 60000)
  fs.utimesSync(path.join(p, 'old.jsonl'), past, past)
  assert.strictEqual(st.transcriptFor(dir, home), path.join(p, 'new.jsonl'))
  assert.strictEqual(st.transcriptFor('/nope', home), null)
})

test('summarize splits today from the 7-day total', () => {
  const daily = [
    { period: '2026-09-25', totalTokens: 100, totalCost: 1.5 },
    { period: '2026-09-26', totalTokens: 50, totalCost: 0.5 }
  ]
  assert.deepStrictEqual(st.summarize(daily, '2026-09-26'), { today: { tokens: 50, cost: 0.5 }, week: { tokens: 150, cost: 2 } })
  assert.deepStrictEqual(st.summarize(daily, '2026-09-27').today, null)
})

test('formatStatus renders every row and degrades without ccusage', () => {
  const out = st.formatStatus({
    dir: '/p',
    ctx: { used: 23, remaining: 77 },
    sessionTokens: 12300000,
    usage: null,
    companions: { graphify: true, ponytail: false, ccusage: false, fastJev: false, headroom: true },
    results: [{ step: 'graph', ok: true, ts: '2026-09-26T18:00:00.000Z' }],
    alerts: []
  })
  assert.match(out, /23% used/)
  assert.match(out, /12\.3M/)
  assert.match(out, /ccusage not available/)
  assert.match(out, /graphify ✓/)
  assert.match(out, /ponytail ✗/)
  assert.match(out, /graph ok/)
  assert.match(out, /Health: ok/)
})
