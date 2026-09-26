'use strict'
const fs = require('fs')
const path = require('path')
const io = require('./lib/io')
const { tailRecords, lastEditMs } = require('./lib/transcript')

const COOLDOWN_MS = 30 * 60 * 1000
const MSG = {
  it: '📝 Gerry: file modificati in questa sessione, HANDOFF.md non aggiornato. Quando chiudi, di\' "chiudiamo" e Gerry salva la sessione.',
  en: '📝 Gerry: files changed this session and HANDOFF.md is not updated. When you wrap up, say "let\'s close" and Gerry saves the session.'
}

function main (input, now = Date.now()) {
  const dir = io.projectDir(input)
  const handoff = path.join(dir, 'HANDOFF.md')
  if (!input.transcript_path || !fs.existsSync(handoff)) return
  const last = lastEditMs(tailRecords(input.transcript_path), [handoff, path.join(dir, 'HANDOFF-archive.md')])
  if (last === null || fs.statSync(handoff).mtimeMs >= last) return
  const file = path.join(io.dataDir(), 'stop-cooldown.json')
  const cooldown = io.readJson(file, {})
  if (now - (cooldown[dir] || 0) < COOLDOWN_MS) return
  cooldown[dir] = now
  io.writeJson(file, cooldown)
  io.emit({ systemMessage: MSG[io.option('language', 'auto')] || MSG.en })
}

if (require.main === module) io.run(main)
module.exports = { MSG, main }
