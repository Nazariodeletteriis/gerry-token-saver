'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, fakeBin } = require('./helpers')
const s = require('../plugins/gerry/scripts/sync')

function project (name = 'My Project è') {
  const root = tmp()
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'graphify-out', 'obsidian'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'HANDOFF.md'), '# HANDOFF\n')
  fs.writeFileSync(path.join(dir, 'graphify-out', 'graph.json'), '{}')
  fs.writeFileSync(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md'), '# Graph Report\n')
  fs.writeFileSync(path.join(dir, 'graphify-out', 'obsidian', 'Node.md'), 'node')
  return { root, dir, data: path.join(root, 'data') }
}

function withPath (bin, fn) {
  const old = process.env.PATH
  process.env.PATH = bin + path.delimiter + old
  try { return fn() } finally { process.env.PATH = old }
}

test('graph update runs graphify update in the project (path with spaces)', () => {
  const { root, dir, data } = project()
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  fakeBin(bin, 'graphify', 0)
  withPath(bin, () => s.sync(dir, { graphify: 'suggest', vault: '' }, data))
  assert.match(fs.readFileSync(path.join(bin, 'graphify.args'), 'utf8'), /update \./)
  const [r] = s.lastResults(data, dir)
  assert.deepStrictEqual([r.step, r.ok], ['graph', true])
})

test('graphify failure is logged with a message', () => {
  const { root, dir, data } = project()
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  fakeBin(bin, 'graphify', 1)
  withPath(bin, () => s.sync(dir, { graphify: 'suggest', vault: '' }, data))
  assert.strictEqual(s.lastResults(data, dir)[0].ok, false)
})

test('graphify missing from PATH is logged as failure', () => {
  const { dir, data } = project()
  const old = process.env.PATH
  process.env.PATH = ''
  try { s.sync(dir, { graphify: 'suggest', vault: '' }, data) } finally { process.env.PATH = old }
  assert.match(s.lastResults(data, dir)[0].msg, /not found/)
})

test('graphify off skips the graph step', () => {
  const { dir, data } = project()
  s.sync(dir, { graphify: 'off', vault: '' }, data)
  assert.deepStrictEqual(s.lastResults(data, dir), [])
})

test('obsidian copies HANDOFF and graph into <vault>/<project>/', () => {
  const { root, dir, data } = project()
  const vault = path.join(root, 'Memory')
  fs.mkdirSync(vault)
  s.sync(dir, { graphify: 'off', vault }, data)
  const dest = path.join(vault, path.basename(dir))
  assert.ok(fs.existsSync(path.join(dest, 'HANDOFF.md')))
  assert.ok(fs.existsSync(path.join(dest, 'graph', 'GRAPH_REPORT.md')))
  assert.ok(fs.existsSync(path.join(dest, 'graph', 'Node.md')))
  assert.strictEqual(s.lastResults(data, dir).find(r => r.step === 'obsidian').ok, true)
})

test('missing vault is logged as obsidian failure', () => {
  const { root, dir, data } = project()
  s.sync(dir, { graphify: 'off', vault: path.join(root, 'nope') }, data)
  assert.match(s.lastResults(data, dir).find(r => r.step === 'obsidian').msg, /vault not found/)
})

test('a held lock makes a second sync exit without logging', () => {
  const { dir, data } = project()
  const lock = path.join(data, 'locks', require('crypto').createHash('sha1').update(dir).digest('hex').slice(0, 12) + '.lock')
  fs.mkdirSync(path.dirname(lock), { recursive: true })
  fs.writeFileSync(lock, '')
  s.sync(dir, { graphify: 'off', vault: path.join(dir, 'x') }, data)
  assert.deepStrictEqual(s.lastResults(data, dir), [])
})
