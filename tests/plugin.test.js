'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'plugins', 'gerry')
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))

test('every hook runs node in exec form on an existing script', () => {
  const { hooks } = read('hooks/hooks.json')
  assert.deepStrictEqual(Object.keys(hooks).sort(), ['PostToolUse', 'SessionEnd', 'SessionStart', 'Stop'])
  for (const groups of Object.values(hooks)) {
    for (const h of groups.flatMap(g => g.hooks)) {
      assert.strictEqual(h.command, 'node')
      const script = h.args[0].replace('${CLAUDE_PLUGIN_ROOT}', ROOT)
      assert.ok(fs.existsSync(script), script)
    }
  }
  assert.strictEqual(hooks.SessionEnd[0].hooks[0].async, true)
})

test('userConfig keys match the options the scripts read', () => {
  const { userConfig } = read('.claude-plugin/plugin.json')
  assert.deepStrictEqual(Object.keys(userConfig).sort(), ['context_window', 'graphify', 'language', 'obsidian_vault'])
})
