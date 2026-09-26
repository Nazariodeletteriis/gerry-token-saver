'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'gerry', 'scripts')

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gerry-test-'))
}

function writeTranscript (file, records) {
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n')
  return file
}

let seq = 0
function assistant ({ tokens = 0, tools = [], ts = '2026-09-26T10:00:00.000Z', sidechain = false, id } = {}) {
  return {
    type: 'assistant',
    isSidechain: sidechain,
    timestamp: ts,
    message: {
      id: id || `msg_${++seq}`,
      role: 'assistant',
      usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens, output_tokens: 10 },
      content: tools.map(([name, filePath]) => ({ type: 'tool_use', name, input: { file_path: filePath } }))
    }
  }
}

function runScript (name, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, name)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, GERRY_NO_SYNC: '1', CLAUDE_PROJECT_DIR: '', ...env }
  })
  let out = null
  try { out = r.stdout ? JSON.parse(r.stdout) : null } catch {}
  return { out, raw: r.stdout, status: r.status }
}

function fakeBin (dir, name, exitCode, stdout = '') {
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, name + '.cmd'), `@echo off\r\necho ${stdout}\r\necho %*> "%~dp0${name}.args"\r\nexit /b ${exitCode}\r\n`)
  } else {
    const f = path.join(dir, name)
    fs.writeFileSync(f, `#!/bin/sh\necho '${stdout}'\necho "$@" > "$(dirname "$0")/${name}.args"\nexit ${exitCode}\n`)
    fs.chmodSync(f, 0o755)
  }
}

module.exports = { SCRIPTS, tmp, writeTranscript, assistant, runScript, fakeBin }
