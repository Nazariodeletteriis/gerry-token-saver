'use strict'
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { tmp, fakeBin } = require('./helpers')
const c = require('../plugins/gerry/scripts/lib/companions')

test('which finds a binary on PATH', () => {
  const bin = tmp()
  fakeBin(bin, 'graphify', 0)
  const old = process.env.PATH
  process.env.PATH = bin + path.delimiter + old
  assert.ok(c.which('graphify'))
  assert.strictEqual(c.which('definitely-not-here-xyz'), null)
  process.env.PATH = old
})

test('pluginEnabled matches name@marketplace set to true', () => {
  const s = { enabledPlugins: { 'ponytail@gerry-token-saver': true, 'fast-jev-compaction@x': false } }
  assert.strictEqual(c.pluginEnabled(s, 'ponytail'), true)
  assert.strictEqual(c.pluginEnabled(s, 'fast-jev-compaction'), false)
  assert.strictEqual(c.pluginEnabled({}, 'ponytail'), false)
})

test('runCmd reports exit status and output', () => {
  const bin = tmp()
  fakeBin(bin, 'okcmd', 0, 'hello')
  fakeBin(bin, 'badcmd', 3)
  const cmd = n => path.join(bin, n + (process.platform === 'win32' ? '.cmd' : ''))
  assert.strictEqual(c.runCmd(cmd('okcmd'), [], bin, 5000).ok, true)
  assert.match(c.runCmd(cmd('okcmd'), [], bin, 5000).out, /hello/)
  assert.strictEqual(c.runCmd(cmd('badcmd'), [], bin, 5000).ok, false)
})
