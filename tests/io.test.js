'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp } = require('./helpers')
const io = require('../plugins/gerry/scripts/lib/io')

test('option returns default when env is missing or empty', () => {
  delete process.env.CLAUDE_PLUGIN_OPTION_LANGUAGE
  assert.strictEqual(io.option('language', 'auto'), 'auto')
  process.env.CLAUDE_PLUGIN_OPTION_LANGUAGE = ''
  assert.strictEqual(io.option('language', 'auto'), 'auto')
  process.env.CLAUDE_PLUGIN_OPTION_LANGUAGE = 'it'
  assert.strictEqual(io.option('language', 'auto'), 'it')
  delete process.env.CLAUDE_PLUGIN_OPTION_LANGUAGE
})

test('readJson falls back on missing or corrupt file', () => {
  const d = tmp()
  assert.deepStrictEqual(io.readJson(path.join(d, 'nope.json'), { a: 1 }), { a: 1 })
  fs.writeFileSync(path.join(d, 'bad.json'), '{"a":')
  assert.deepStrictEqual(io.readJson(path.join(d, 'bad.json'), {}), {})
})

test('writeJson creates missing directories', () => {
  const f = path.join(tmp(), 'a', 'b', 'c.json')
  io.writeJson(f, { ok: true })
  assert.deepStrictEqual(io.readJson(f, null), { ok: true })
})

test('projectDir prefers CLAUDE_PROJECT_DIR, then input.cwd', () => {
  delete process.env.CLAUDE_PROJECT_DIR
  assert.strictEqual(io.projectDir({ cwd: '/x' }), '/x')
  process.env.CLAUDE_PROJECT_DIR = '/root'
  assert.strictEqual(io.projectDir({ cwd: '/x' }), '/root')
  delete process.env.CLAUDE_PROJECT_DIR
})

test('dataDir uses CLAUDE_PLUGIN_DATA and creates it', () => {
  const d = path.join(tmp(), 'data')
  process.env.CLAUDE_PLUGIN_DATA = d
  assert.strictEqual(io.dataDir(), d)
  assert.ok(fs.existsSync(d))
  delete process.env.CLAUDE_PLUGIN_DATA
})
