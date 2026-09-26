'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

function readStdin () {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return {} }
}

function emit (obj) {
  process.stdout.write(JSON.stringify(obj))
}

function option (key, def) {
  const v = process.env['CLAUDE_PLUGIN_OPTION_' + key.toUpperCase()]
  return v === undefined || v === '' ? def : v
}

function dataDir () {
  const d = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'gerry-data')
  fs.mkdirSync(d, { recursive: true })
  return d
}

function readJson (file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson (file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj))
}

function projectDir (input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
}

function settingsPath () {
  return process.env.GERRY_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json')
}

function run (fn) {
  try { fn(readStdin()) } catch (e) { if (process.env.GERRY_DEBUG) console.error(e) }
}

module.exports = { readStdin, emit, option, dataDir, readJson, writeJson, projectDir, settingsPath, run }
