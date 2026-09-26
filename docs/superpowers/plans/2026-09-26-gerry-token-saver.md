# Gerry token-saver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire il plugin Claude Code `gerry` (hook + agente + comando) e il marketplace `gerry-token-saver` descritti nella spec, con test automatici. Copre i task T4–T15 di TASKS.md; migrazione (T16–T21) e pubblicazione (T22–T23) sono piani separati.

**Architecture:** Quattro script hook Node (SessionStart, PostToolUse, Stop, SessionEnd) che leggono transcript e file di progetto e scrivono solo JSON su stdout; stato persistente in `${CLAUDE_PLUGIN_DATA}`. Un agente `gerry:gerry` che riscrive HANDOFF.md. Un comando `/gerry:status` che stampa una tabella. Tutta la logica sta in funzioni pure esportate e testate con `node:test`; ogni script ha un `main` che gira solo se lanciato direttamente.

**Tech Stack:** Node ≥ 18, CommonJS, solo libreria standard (`fs`, `path`, `os`, `child_process`, `crypto`, `node:test`, `node:assert`). Nessuna dipendenza npm.

**Spec:** `docs/superpowers/specs/2026-09-26-gerry-token-saver-design.md`

## Global Constraints

- Node ≥ 18, CommonJS (`'use strict'`, `require`), **zero dipendenze npm**.
- Ogni hook esce con codice 0 in qualunque caso: gli errori vengono ingoiati da `run()` (stampati su stderr solo se `GERRY_DEBUG` è impostato).
- Output di ogni hook < 10.000 caratteri (limite di Claude Code); SessionStart tronca a 9.500.
- Testi rivolti al modello in inglese; l'unico testo mostrato direttamente all'utente (Stop `systemMessage`) esiste in `it` e `en`.
- Chiavi di config (`userConfig`): `language`, `context_window`, `graphify`, `obsidian_vault` → env `CLAUDE_PLUGIN_OPTION_LANGUAGE`, `…_CONTEXT_WINDOW`, `…_GRAPHIFY`, `…_OBSIDIAN_VAULT`.
- Costanti fisse: avviso a 60% usato, CRITICAL a 30% rimanente, buffer auto-compact 10%, HANDOFF max 60 righe, cooldown Stop 30 min, lock sync scaduto dopo 10 min, progetto "grande" = ≥ 20 file.
- Claude Code ≥ 2.1.271 (per `options` in `userConfig`).
- Nome marketplace `gerry-token-saver`, plugin `gerry`, agente `gerry:gerry`, comando `/gerry:status`.
- Commit con trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Prima di dichiarare finito un task: `ponytail-review` sul diff del task (solo over-engineering).

## Review Focus

1. **Riga del transcript più lunga della finestra letta** (es. screenshot base64 da 5 MB): la coda è una sola riga troncata → nessun record → l'hook resta muto, non va in crash. Test in Task 2.
2. **Cartella progetto con spazi o caratteri non ASCII** (`/mnt/c/Users/nazar/My Project è`): sync, copia Obsidian e lancio in background funzionano. Test in Task 5.
3. **HANDOFF.md con fine riga Windows (CRLF)**: conteggio righe e troncamento corretti, nessun `\r` sporco nel briefing. Test in Task 6.
4. **File di stato corrotti** in `${CLAUDE_PLUGIN_DATA}` (scrittura interrotta): trattati come vuoti, l'hook continua. Test in Task 3.
5. **Due sessioni sullo stesso progetto** che lanciano sync insieme: il lock fa girare solo la prima, la seconda esce senza scrivere nel log. Test in Task 5.

---

## Struttura file

```
.claude-plugin/marketplace.json            marketplace: gerry + ponytail
.github/workflows/test.yml                 CI Linux/macOS/Windows
plugins/gerry/.claude-plugin/plugin.json   manifest + userConfig
plugins/gerry/hooks/hooks.json             collega i 4 eventi agli script
plugins/gerry/scripts/lib/io.js            stdin/stdout, opzioni, stato, percorsi
plugins/gerry/scripts/lib/transcript.js    lettura transcript: token, ultima modifica, totali
plugins/gerry/scripts/lib/companions.js    which(), plugin abilitati, detect(), runCmd()
plugins/gerry/scripts/context.js           PostToolUse: avvisi di contesto
plugins/gerry/scripts/stop.js              Stop: promemoria HANDOFF all'utente
plugins/gerry/scripts/sync.js              SessionEnd + recupero: graphify update, Obsidian, log
plugins/gerry/scripts/session-start.js     SessionStart: briefing, companion, salute
plugins/gerry/scripts/status.js            /gerry:status
plugins/gerry/agents/gerry.md              agente session-end
plugins/gerry/commands/status.md           comando /gerry:status
tests/helpers.js                           cartelle temporanee, transcript finti, lancio script
tests/*.test.js                            un file per modulo
```

---

### Task 1: Scheletro plugin, `lib/io.js`, CI

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/gerry/.claude-plugin/plugin.json`
- Create: `plugins/gerry/scripts/lib/io.js`
- Create: `.github/workflows/test.yml`
- Create: `tests/helpers.js`
- Test: `tests/io.test.js`

**Interfaces:**
- Produces (`lib/io.js`):
  - `readStdin(): object` — JSON da stdin, `{}` se vuoto o invalido
  - `emit(obj: object): void` — scrive `JSON.stringify(obj)` su stdout
  - `option(key: string, def: string): string` — legge `CLAUDE_PLUGIN_OPTION_<KEY>`, `def` se assente o vuota
  - `dataDir(): string` — `CLAUDE_PLUGIN_DATA` o `<tmp>/gerry-data`, creata se manca
  - `readJson(file: string, fallback: any): any`
  - `writeJson(file: string, obj: any): void` — crea le cartelle mancanti
  - `projectDir(input: object): string` — `CLAUDE_PROJECT_DIR` > `input.cwd` > `process.cwd()`
  - `settingsPath(): string` — `GERRY_SETTINGS` o `~/.claude/settings.json`
  - `run(fn: (input) => void): void` — chiama `fn(readStdin())`, ingoia ogni errore
- Produces (`tests/helpers.js`):
  - `tmp(): string` — cartella temporanea nuova
  - `writeTranscript(file: string, records: object[]): string`
  - `assistant({ tokens?, tools?, ts?, sidechain?, id? }): object` — record assistant finto
  - `runScript(name: string, input: object, env?: object): { out: object|null, raw: string, status: number }`

- [ ] **Step 1: Scrivi manifest e marketplace**

`.claude-plugin/marketplace.json`:
```json
{
  "name": "gerry-token-saver",
  "owner": { "name": "Nazario De Letteriis" },
  "plugins": [
    {
      "name": "gerry",
      "source": "./plugins/gerry",
      "description": "Session memory and context guard: HANDOFF.md briefing at zero model tokens, context alerts only when needed, compact handoffs."
    },
    {
      "name": "ponytail",
      "source": { "source": "github", "repo": "DietrichGebert/ponytail" },
      "description": "Companion (upstream): forces the simplest code that works."
    }
  ]
}
```

`plugins/gerry/.claude-plugin/plugin.json`:
```json
{
  "name": "gerry",
  "version": "0.1.0",
  "description": "Session memory and context guard for Claude Code: HANDOFF.md briefing at zero model tokens, context alerts only when needed, compact handoffs.",
  "author": { "name": "Nazario De Letteriis" },
  "repository": "https://github.com/Nazariodeletteriis/gerry-token-saver",
  "license": "MIT",
  "userConfig": {
    "language": {
      "type": "string",
      "title": "Language",
      "description": "Language code for replies and HANDOFF.md (e.g. it, en), or auto to follow the conversation.",
      "default": "auto"
    },
    "context_window": {
      "type": "string",
      "title": "Context window",
      "description": "auto = 1M if your model setting has [1m], otherwise 200k.",
      "options": ["auto", "200000", "1000000"],
      "default": "auto"
    },
    "graphify": {
      "type": "string",
      "title": "graphify",
      "description": "off, suggest a knowledge graph on large projects, or ask Claude to build it automatically.",
      "options": ["off", "suggest", "auto"],
      "default": "suggest"
    },
    "obsidian_vault": {
      "type": "directory",
      "title": "Obsidian vault",
      "description": "Copy HANDOFF.md and the graph into <vault>/<project>/. Leave empty to disable.",
      "default": ""
    }
  }
}
```

- [ ] **Step 2: Scrivi gli helper dei test**

`tests/helpers.js`:
```js
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

module.exports = { SCRIPTS, tmp, writeTranscript, assistant, runScript }
```

- [ ] **Step 3: Scrivi il test di `io.js` che fallisce**

`tests/io.test.js`:
```js
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
```

- [ ] **Step 4: Lancia il test e verifica che fallisce**

Run: `node --test tests/io.test.js`
Expected: FAIL con `Cannot find module '../plugins/gerry/scripts/lib/io'`

- [ ] **Step 5: Implementa `lib/io.js`**

`plugins/gerry/scripts/lib/io.js`:
```js
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
```

- [ ] **Step 6: Lancia il test e verifica che passa**

Run: `node --test tests/io.test.js`
Expected: PASS (5 test)

- [ ] **Step 7: Scrivi la CI**

`.github/workflows/test.yml`:
```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: node --test tests/
```

- [ ] **Step 8: Valida il plugin**

Run: `claude --version` (deve essere ≥ 2.1.271; se no `claude update`), poi `claude plugin validate plugins/gerry` e `claude plugin validate .`
Expected: nessun errore. Se `default: ""` su `obsidian_vault` viene rifiutato, togli il campo `default` da quell'opzione.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin plugins/gerry/.claude-plugin plugins/gerry/scripts/lib/io.js .github tests/helpers.js tests/io.test.js
git commit -m "feat: plugin skeleton, io helpers, CI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `lib/transcript.js`

**Files:**
- Create: `plugins/gerry/scripts/lib/transcript.js`
- Test: `tests/transcript.test.js`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `tailRecords(file: string, bytes?: number = 4 MiB): object[]` — record JSON delle ultime `bytes` del file; la prima riga viene scartata se la lettura non parte dall'inizio; righe non JSON ignorate. `bytes = Infinity` legge tutto.
  - `contextTokens(records: object[]): number|null` — dall'ultimo record non `isSidechain` con `message.usage`: `input + cache_creation + cache_read`.
  - `lastEditMs(records: object[], ignore: string[]): number|null` — timestamp (ms) dell'ultimo `tool_use` `Edit`/`Write`/`NotebookEdit` in record `assistant` non sidechain, escludendo i percorsi in `ignore`.
  - `sessionTokens(records: object[]): number` — somma di input+output+cache_creation+cache_read sui record assistant non sidechain, contando una volta sola ogni `message.id`.

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/transcript.test.js`:
```js
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
```

- [ ] **Step 2: Lancia il test e verifica che fallisce**

Run: `node --test tests/transcript.test.js`
Expected: FAIL con `Cannot find module`

- [ ] **Step 3: Implementa**

`plugins/gerry/scripts/lib/transcript.js`:
```js
'use strict'
const fs = require('fs')
const path = require('path')

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

function tailRecords (file, bytes = 4 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const from = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - from)
    fs.readSync(fd, buf, 0, buf.length, from)
    const lines = buf.toString('utf8').split('\n')
    if (from > 0) lines.shift()
    const out = []
    for (const l of lines) {
      if (!l) continue
      try { out.push(JSON.parse(l)) } catch {}
    }
    return out
  } finally {
    fs.closeSync(fd)
  }
}

function usageOf (r) {
  return !r.isSidechain && r.message && r.message.usage
}

function contextTokens (records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const u = usageOf(records[i])
    if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
  return null
}

function lastEditMs (records, ignore) {
  const skip = new Set(ignore.map(p => path.resolve(p)))
  let last = null
  for (const r of records) {
    if (r.type !== 'assistant' || r.isSidechain || !Array.isArray(r.message && r.message.content)) continue
    for (const c of r.message.content) {
      if (c.type !== 'tool_use' || !EDIT_TOOLS.has(c.name)) continue
      const p = c.input && (c.input.file_path || c.input.notebook_path)
      if (!p || skip.has(path.resolve(p))) continue
      const ms = Date.parse(r.timestamp)
      if (!Number.isNaN(ms) && (last === null || ms > last)) last = ms
    }
  }
  return last
}

function sessionTokens (records) {
  const seen = new Set()
  let sum = 0
  for (const r of records) {
    const u = r.type === 'assistant' && usageOf(r)
    if (!u || seen.has(r.message.id)) continue
    seen.add(r.message.id)
    sum += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
  }
  return sum
}

module.exports = { tailRecords, contextTokens, lastEditMs, sessionTokens }
```

- [ ] **Step 4: Lancia il test e verifica che passa**

Run: `node --test tests/transcript.test.js`
Expected: PASS (6 test)

- [ ] **Step 5: Commit**

```bash
git add plugins/gerry/scripts/lib/transcript.js tests/transcript.test.js
git commit -m "feat: transcript reader (context tokens, last edit, session totals)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `context.js` — avvisi di contesto (PostToolUse)

**Files:**
- Create: `plugins/gerry/scripts/context.js`
- Test: `tests/context.test.js`

**Interfaces:**
- Consumes: `io.{run, emit, option, dataDir, readJson, writeJson, projectDir, settingsPath}`, `transcript.{tailRecords, contextTokens}`.
- Produces:
  - `contextWindow(opt: string, settingsFile: string): number` — `GERRY_CTX_LIMIT` se impostato; `200000`/`1000000` se `opt` lo è; altrimenti 1.000.000 se `model` in settings contiene `[1m]`, sennò 200.000.
  - `usage(tokens: number, window: number): { used: number, remaining: number }` — percentuali intere sul contesto utilizzabile (buffer 10%).
  - `decide(u, state: { warned?, critical? }): 'warn'|'critical'|null`
  - Stato: `<dataDir>/sessions/<session_id>.json` = `{ warned: bool, critical: bool }`.

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/context.test.js`:
```js
'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, writeTranscript, assistant, runScript } = require('./helpers')
const c = require('../plugins/gerry/scripts/context')

test('usage maps tokens to usable percentages', () => {
  assert.deepStrictEqual(c.usage(90000, 200000), { used: 50, remaining: 50 })
  assert.deepStrictEqual(c.usage(110000, 200000), { used: 61, remaining: 39 })
  assert.deepStrictEqual(c.usage(135000, 200000), { used: 75, remaining: 25 })
  assert.deepStrictEqual(c.usage(500000, 200000), { used: 100, remaining: 0 })
})

test('decide fires each threshold once, critical wins', () => {
  assert.strictEqual(c.decide({ used: 50, remaining: 50 }, {}), null)
  assert.strictEqual(c.decide({ used: 61, remaining: 39 }, {}), 'warn')
  assert.strictEqual(c.decide({ used: 61, remaining: 39 }, { warned: true }), null)
  assert.strictEqual(c.decide({ used: 75, remaining: 25 }, { warned: true }), 'critical')
  assert.strictEqual(c.decide({ used: 75, remaining: 25 }, { critical: true, warned: true }), null)
})

test('contextWindow: option, then [1m] in settings, then 200k', () => {
  const d = tmp()
  const s = path.join(d, 'settings.json')
  fs.writeFileSync(s, JSON.stringify({ model: 'opus[1m]' }))
  assert.strictEqual(c.contextWindow('auto', s), 1000000)
  assert.strictEqual(c.contextWindow('200000', s), 200000)
  fs.writeFileSync(s, JSON.stringify({ model: 'sonnet' }))
  assert.strictEqual(c.contextWindow('auto', s), 200000)
  assert.strictEqual(c.contextWindow('auto', path.join(d, 'missing.json')), 200000)
})

function env (d) {
  return { CLAUDE_PLUGIN_DATA: path.join(d, 'data'), CLAUDE_PLUGIN_OPTION_CONTEXT_WINDOW: '200000', GERRY_CTX_LIMIT: '' }
}

test('hook is silent below threshold', () => {
  const d = tmp()
  const tr = writeTranscript(path.join(d, 't.jsonl'), [assistant({ tokens: 90000 })])
  const r = runScript('context.js', { session_id: 's1', transcript_path: tr, cwd: d }, env(d))
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.out, null)
})

test('hook warns once, then goes critical once', () => {
  const d = tmp()
  const tr = path.join(d, 't.jsonl')
  const input = { session_id: 's2', transcript_path: tr, cwd: d }
  writeTranscript(tr, [assistant({ tokens: 110000 })])
  const first = runScript('context.js', input, env(d))
  assert.match(first.out.hookSpecificOutput.additionalContext, /context at 61%/)
  assert.strictEqual(first.out.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.strictEqual(runScript('context.js', input, env(d)).out, null)
  writeTranscript(tr, [assistant({ tokens: 135000 })])
  const crit = runScript('context.js', input, env(d))
  assert.match(crit.out.hookSpecificOutput.additionalContext, /CRITICAL.*gerry:gerry.*session-end/s)
  assert.strictEqual(runScript('context.js', input, env(d)).out, null)
})

test('corrupt session state is treated as empty', () => {
  const d = tmp()
  const e = env(d)
  fs.mkdirSync(path.join(e.CLAUDE_PLUGIN_DATA, 'sessions'), { recursive: true })
  fs.writeFileSync(path.join(e.CLAUDE_PLUGIN_DATA, 'sessions', 's3.json'), '{"warn')
  const tr = writeTranscript(path.join(d, 't.jsonl'), [assistant({ tokens: 110000 })])
  const r = runScript('context.js', { session_id: 's3', transcript_path: tr, cwd: d }, e)
  assert.match(r.out.hookSpecificOutput.additionalContext, /context at 61%/)
})

test('missing transcript exits 0 with no output', () => {
  const d = tmp()
  const r = runScript('context.js', { session_id: 's4', transcript_path: path.join(d, 'nope.jsonl') }, env(d))
  assert.strictEqual(r.status, 0)
  assert.strictEqual(r.raw, '')
})
```

- [ ] **Step 2: Lancia il test e verifica che fallisce**

Run: `node --test tests/context.test.js`
Expected: FAIL con `Cannot find module '../plugins/gerry/scripts/context'`

- [ ] **Step 3: Implementa**

`plugins/gerry/scripts/context.js`:
```js
'use strict'
const path = require('path')
const io = require('./lib/io')
const { tailRecords, contextTokens } = require('./lib/transcript')

const WARN_USED = 60
const CRITICAL_REMAINING = 30
const COMPACT_BUFFER = 10

function contextWindow (opt, settingsFile) {
  if (process.env.GERRY_CTX_LIMIT) return Number(process.env.GERRY_CTX_LIMIT)
  if (opt === '200000' || opt === '1000000') return Number(opt)
  const model = String(io.readJson(settingsFile, {}).model || '')
  return model.includes('[1m]') ? 1000000 : 200000
}

function usage (tokens, window) {
  const raw = Math.max(0, (1 - tokens / window) * 100)
  const remaining = Math.round(Math.max(0, (raw - COMPACT_BUFFER) / (100 - COMPACT_BUFFER) * 100))
  return { used: 100 - remaining, remaining }
}

function decide (u, state) {
  if (u.remaining <= CRITICAL_REMAINING && !state.critical) return 'critical'
  if (u.used >= WARN_USED && !state.warned && !state.critical) return 'warn'
  return null
}

function main (input) {
  if (!input.transcript_path) return
  const tokens = contextTokens(tailRecords(input.transcript_path, 512 * 1024))
  if (tokens === null) return
  const u = usage(tokens, contextWindow(io.option('context_window', 'auto'), io.settingsPath()))
  const file = path.join(io.dataDir(), 'sessions', `${input.session_id || 'default'}.json`)
  const state = io.readJson(file, {})
  const level = decide(u, state)
  if (!level) return
  state.warned = true
  if (level === 'critical') state.critical = true
  io.writeJson(file, state)
  const dir = io.projectDir(input)
  const text = level === 'warn'
    ? `Gerry: context at ${u.used}% (${u.remaining}% left). Tell the user in one line: when the current task is done, it is worth closing this session.`
    : `Gerry CRITICAL: context at ${u.used}% (${u.remaining}% left). Write a real summary of this session, dispatch the gerry:gerry agent with "session-end: ${dir} | <summary>", then suggest the user opens a new session.`
  io.emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })
}

if (require.main === module) io.run(main)
module.exports = { contextWindow, usage, decide, main }
```

- [ ] **Step 4: Lancia il test e verifica che passa**

Run: `node --test tests/context.test.js`
Expected: PASS (7 test)

- [ ] **Step 5: Commit**

```bash
git add plugins/gerry/scripts/context.js tests/context.test.js
git commit -m "feat: context alerts, once per threshold, no timer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `stop.js` — promemoria HANDOFF all'utente

**Files:**
- Create: `plugins/gerry/scripts/stop.js`
- Test: `tests/stop.test.js`

**Interfaces:**
- Consumes: `io.*`, `transcript.{tailRecords, lastEditMs}`.
- Produces:
  - `MSG: { it: string, en: string }`
  - `main(input, now?: number)`: emette `{ systemMessage }` solo se c'è HANDOFF.md, c'è stata una modifica dopo il suo mtime e il cooldown per progetto (30 min, `<dataDir>/stop-cooldown.json` = `{ [dir]: ms }`) è scaduto. Mai `additionalContext`, mai `decision`.

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/stop.test.js`:
```js
'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tmp, writeTranscript, assistant, runScript } = require('./helpers')

function setup ({ handoff = true, editMinutesAfterHandoff = 5 } = {}) {
  const d = tmp() // not a git repo on purpose
  const handoffPath = path.join(d, 'HANDOFF.md')
  if (handoff) {
    fs.writeFileSync(handoffPath, '# HANDOFF\n')
    const past = new Date(Date.now() - 60 * 60 * 1000)
    fs.utimesSync(handoffPath, past, past)
  }
  const editAt = new Date(Date.now() - 60 * 60 * 1000 + editMinutesAfterHandoff * 60 * 1000).toISOString()
  const tr = writeTranscript(path.join(d, 't.jsonl'), [assistant({ tools: [['Edit', path.join(d, 'app.js')]], ts: editAt })])
  const env = { CLAUDE_PLUGIN_DATA: path.join(d, 'data'), CLAUDE_PLUGIN_OPTION_LANGUAGE: 'it' }
  return { d, input: { transcript_path: tr, cwd: d }, env }
}

test('edit after HANDOFF in a non-git dir -> one systemMessage, then cooldown', () => {
  const { input, env } = setup()
  const r = runScript('stop.js', input, env)
  assert.strictEqual(r.status, 0)
  assert.match(r.out.systemMessage, /HANDOFF/)
  assert.strictEqual(r.out.hookSpecificOutput, undefined)
  assert.strictEqual(r.out.decision, undefined)
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('HANDOFF updated after the last edit -> silent', () => {
  const { input, env } = setup({ editMinutesAfterHandoff: -5 })
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('no HANDOFF.md -> silent', () => {
  const { input, env } = setup({ handoff: false })
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('no edits in transcript -> silent', () => {
  const { d, input, env } = setup()
  writeTranscript(input.transcript_path, [assistant({ tools: [['Read', path.join(d, 'app.js')]] })])
  assert.strictEqual(runScript('stop.js', input, env).out, null)
})

test('english message when language is auto', () => {
  const { input, env } = setup()
  env.CLAUDE_PLUGIN_OPTION_LANGUAGE = 'auto'
  assert.match(runScript('stop.js', input, env).out.systemMessage, /files changed/)
})
```

- [ ] **Step 2: Lancia il test e verifica che fallisce**

Run: `node --test tests/stop.test.js`
Expected: FAIL (lo script non esiste: `status` ≠ 0 e `out` null)

- [ ] **Step 3: Implementa**

`plugins/gerry/scripts/stop.js`:
```js
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
```

- [ ] **Step 4: Lancia il test e verifica che passa**

Run: `node --test tests/stop.test.js`
Expected: PASS (5 test)

- [ ] **Step 5: Commit**

```bash
git add plugins/gerry/scripts/stop.js tests/stop.test.js
git commit -m "feat: Stop reminder to the user, no git, no forced continuation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `lib/companions.js` + `sync.js`

**Files:**
- Create: `plugins/gerry/scripts/lib/companions.js`
- Create: `plugins/gerry/scripts/sync.js`
- Test: `tests/companions.test.js`, `tests/sync.test.js`

**Interfaces:**
- Consumes: `io.*`.
- Produces (`lib/companions.js`):
  - `which(cmd: string): string|null` — cerca nel `PATH` (con `PATHEXT` su Windows)
  - `pluginEnabled(settings: object, name: string): boolean` — una chiave `enabledPlugins` che inizia con `name@` e vale `true`
  - `detect(settings: object): { graphify, ponytail, ccusage, fastJev, headroom: boolean }`
  - `runCmd(cmd: string, args: string[], cwd: string, timeout: number): { ok: boolean, out: string, err: string }` — `shell: true` solo su Windows
- Produces (`sync.js`):
  - `sync(dir: string, opts: { graphify: string, vault: string }, data: string): void`
  - `lastResults(data: string, dir: string): Array<{ step: 'graph'|'obsidian', ok: boolean, msg: string, ts: string }>` — ultimo esito per passo di quel progetto
  - Log: `<data>/sync-log.jsonl`, una riga `{ ts, project, step, ok, msg }`; oltre 200 KB viene ridotto alle ultime 200 righe.
  - Lock: `<data>/locks/<sha1(dir)[0..12]>.lock`, creato con `wx`, considerato scaduto dopo 10 min.
  - CLI: `node sync.js [dir]` — `dir` da argv, altrimenti `projectDir(stdin)`.

- [ ] **Step 1: Aggiungi a `tests/helpers.js` il binario finto**

Aggiungi in `tests/helpers.js` prima di `module.exports`, ed esportalo:
```js
function fakeBin (dir, name, exitCode, stdout = '') {
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, name + '.cmd'), `@echo off\r\necho ${stdout}\r\necho %*> "%~dp0${name}.args"\r\nexit /b ${exitCode}\r\n`)
  } else {
    const f = path.join(dir, name)
    fs.writeFileSync(f, `#!/bin/sh\necho '${stdout}'\necho "$@" > "$(dirname "$0")/${name}.args"\nexit ${exitCode}\n`)
    fs.chmodSync(f, 0o755)
  }
}
```
```js
module.exports = { SCRIPTS, tmp, writeTranscript, assistant, runScript, fakeBin }
```

- [ ] **Step 2: Scrivi i test che falliscono**

`tests/companions.test.js`:
```js
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
```

`tests/sync.test.js`:
```js
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
```

- [ ] **Step 3: Lancia i test e verifica che falliscono**

Run: `node --test tests/companions.test.js tests/sync.test.js`
Expected: FAIL con `Cannot find module`

- [ ] **Step 4: Implementa `lib/companions.js`**

`plugins/gerry/scripts/lib/companions.js`:
```js
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function which (cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext)
      try { if (fs.statSync(p).isFile()) return p } catch {}
    }
  }
  return null
}

function pluginEnabled (settings, name) {
  return Object.entries(settings.enabledPlugins || {}).some(([k, v]) => v === true && k.startsWith(name + '@'))
}

function detect (settings) {
  return {
    graphify: !!which('graphify'),
    ponytail: pluginEnabled(settings, 'ponytail'),
    ccusage: !!which('ccusage'),
    fastJev: pluginEnabled(settings, 'fast-jev-compaction'),
    headroom: !!which('headroom') && /127\.0\.0\.1|localhost/.test(process.env.ANTHROPIC_BASE_URL || '')
  }
}

function runCmd (cmd, args, cwd, timeout) {
  const win = process.platform === 'win32' // .cmd shims need a shell; quote the path in case it has spaces
  const r = spawnSync(win ? `"${cmd}"` : cmd, args, { cwd, timeout, encoding: 'utf8', shell: win })
  return { ok: r.status === 0, out: r.stdout || '', err: String(r.stderr || (r.error && r.error.message) || '').trim() }
}

module.exports = { which, pluginEnabled, detect, runCmd }
```

- [ ] **Step 5: Implementa `sync.js`**

`plugins/gerry/scripts/sync.js`:
```js
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const io = require('./lib/io')
const { which, runCmd } = require('./lib/companions')

const LOCK_STALE_MS = 10 * 60 * 1000
const LOG_MAX_BYTES = 200 * 1024

function lock (data, dir) {
  const f = path.join(data, 'locks', crypto.createHash('sha1').update(dir).digest('hex').slice(0, 12) + '.lock')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  try {
    fs.closeSync(fs.openSync(f, 'wx'))
    return f
  } catch {
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(f, { force: true })
        return lock(data, dir)
      }
    } catch {}
    return null
  }
}

function log (data, entry) {
  const f = path.join(data, 'sync-log.jsonl')
  fs.appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
  if (fs.statSync(f).size > LOG_MAX_BYTES) {
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').trim().split('\n').slice(-200).join('\n') + '\n')
  }
}

function lastResults (data, dir) {
  let lines = []
  try { lines = fs.readFileSync(path.join(data, 'sync-log.jsonl'), 'utf8').trim().split('\n') } catch {}
  const last = {}
  for (const l of lines) {
    try {
      const e = JSON.parse(l)
      if (e.project === dir) last[e.step] = { step: e.step, ok: e.ok, msg: e.msg, ts: e.ts }
    } catch {}
  }
  return Object.values(last)
}

function newer (src, dst) {
  try {
    return fs.statSync(src).mtimeMs > (fs.existsSync(dst) ? fs.statSync(dst).mtimeMs : 0)
  } catch { return false }
}

function syncGraph (dir) {
  if (!fs.existsSync(path.join(dir, 'graphify-out', 'graph.json'))) return null
  const bin = which('graphify')
  if (!bin) return { ok: false, msg: 'graphify not found in PATH' }
  const r = runCmd(bin, ['update', '.'], dir, 5 * 60 * 1000)
  return { ok: r.ok, msg: r.ok ? 'updated' : r.err.slice(0, 300) || 'graphify update failed' }
}

function syncObsidian (dir, vault) {
  if (!vault) return null
  if (!fs.existsSync(vault)) return { ok: false, msg: `vault not found: ${vault}` }
  const dest = path.join(vault, path.basename(dir))
  const handoff = path.join(dir, 'HANDOFF.md')
  if (newer(handoff, path.join(dest, 'HANDOFF.md'))) {
    fs.mkdirSync(dest, { recursive: true })
    fs.copyFileSync(handoff, path.join(dest, 'HANDOFF.md'))
  }
  const report = path.join(dir, 'graphify-out', 'GRAPH_REPORT.md')
  if (newer(report, path.join(dest, 'graph', 'GRAPH_REPORT.md'))) {
    const obs = path.join(dir, 'graphify-out', 'obsidian')
    if (fs.existsSync(obs)) fs.cpSync(obs, path.join(dest, 'graph'), { recursive: true })
    fs.mkdirSync(path.join(dest, 'graph'), { recursive: true })
    fs.copyFileSync(report, path.join(dest, 'graph', 'GRAPH_REPORT.md'))
  }
  return { ok: true, msg: 'synced' }
}

function step (fn) {
  try { return fn() } catch (e) { return { ok: false, msg: e.message } }
}

function sync (dir, opts, data) {
  const held = lock(data, dir)
  if (!held) return
  try {
    const results = {
      graph: opts.graphify === 'off' ? null : step(() => syncGraph(dir)),
      obsidian: step(() => syncObsidian(dir, opts.vault))
    }
    for (const [name, res] of Object.entries(results)) {
      if (res) log(data, { project: dir, step: name, ...res })
    }
  } finally {
    fs.rmSync(held, { force: true })
  }
}

function main (input) {
  const dir = process.argv[2] || io.projectDir(input)
  sync(dir, { graphify: io.option('graphify', 'suggest'), vault: io.option('obsidian_vault', '') }, io.dataDir())
}

if (require.main === module) io.run(main)
module.exports = { sync, lastResults }
```

- [ ] **Step 6: Lancia i test e verifica che passano**

Run: `node --test tests/companions.test.js tests/sync.test.js`
Expected: PASS (3 + 7 test)

- [ ] **Step 7: Commit**

```bash
git add plugins/gerry/scripts/lib/companions.js plugins/gerry/scripts/sync.js tests/helpers.js tests/companions.test.js tests/sync.test.js
git commit -m "feat: sync (graphify update, Obsidian copy) with lock and log

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `session-start.js` — briefing, companion, salute

**Files:**
- Create: `plugins/gerry/scripts/session-start.js`
- Test: `tests/session-start.test.js`

**Interfaces:**
- Consumes: `io.*`, `companions.detect`, `sync.lastResults`.
- Produces:
  - `handoffBlock(dir: string): { text: string, lines: number }` — righe separate con `/\r?\n/`, max 60 + nota se più lungo; `text` vuoto se manca il file.
  - `graphExtract(report: string): string` — righe non vuote delle sezioni `## Summary` e `## God Nodes`, max 20.
  - `graphBlock(dir: string, mode: string): string`
  - `countFiles(dir: string, limit: number): number` — visita limitata, salta cartelle che iniziano con `.` e `node_modules`, `vendor`, `venv`, `__pycache__`, `dist`, `build`, `graphify-out`.
  - `companionTips(dir: string, found: object, mode: string, large: boolean): Array<[name: string, text: string]>`
  - `healthAlerts({ handoffLines: number, results: object[], nodeMajor: number }): string[]`
  - `briefing(input): string` — il testo completo (≤ 9.500 caratteri), aggiorna `<data>/advised.json` = `{ [dir]: string[] }`.
  - `main(input)`: emette `{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }` se il testo non è vuoto; poi, se `GERRY_NO_SYNC` non è impostato, lancia `sync.js <dir>` staccato.

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/session-start.test.js`:
```js
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
```

- [ ] **Step 2: Lancia il test e verifica che fallisce**

Run: `node --test tests/session-start.test.js`
Expected: FAIL con `Cannot find module`

- [ ] **Step 3: Implementa**

`plugins/gerry/scripts/session-start.js`:
```js
'use strict'
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const io = require('./lib/io')
const { detect } = require('./lib/companions')
const { lastResults } = require('./sync')

const MAX_HANDOFF = 60
const MAX_CHARS = 9500
const LARGE_PROJECT_FILES = 20
const SKIP = new Set(['node_modules', 'vendor', 'venv', '__pycache__', 'dist', 'build', 'graphify-out'])
const FIX = {
  graph: 'run `graphify update .` in the project to see the error; if graphify is missing, `pip install graphifyy`; or set graphify to off in /config.',
  obsidian: 'check obsidian_vault in /config.'
}

function handoffBlock (dir) {
  let lines
  try { lines = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf8').split(/\r?\n/) } catch { return { text: '', lines: 0 } }
  const extra = lines.length - MAX_HANDOFF
  const note = extra > 0 ? `\n[... ${extra} more lines: HANDOFF.md will be compacted at the next session-end]` : ''
  return { text: `## HANDOFF.md (${dir})\n${lines.slice(0, MAX_HANDOFF).join('\n')}${note}`, lines: lines.length }
}

function graphExtract (report) {
  const out = []
  let keep = false
  for (const l of report.split(/\r?\n/)) {
    if (l.startsWith('## ')) keep = /^## (Summary|God Nodes)/.test(l)
    if (keep && l.trim()) out.push(l)
  }
  return out.slice(0, 20).join('\n')
}

function graphBlock (dir, mode) {
  if (mode === 'off') return ''
  let report
  try { report = fs.readFileSync(path.join(dir, 'graphify-out', 'GRAPH_REPORT.md'), 'utf8') } catch { return '' }
  return '## Knowledge graph (graphify-out/)\nUse `graphify query "<question>"` before reading raw files to orient yourself.\n' + graphExtract(report)
}

function countFiles (dir, limit) {
  let n = 0
  const stack = [dir]
  while (stack.length && n < limit) {
    const d = stack.pop()
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue
      if (e.isDirectory()) stack.push(path.join(d, e.name))
      else if (++n >= limit) break
    }
  }
  return n
}

function companionTips (dir, found, mode, large) {
  const tips = []
  if (mode !== 'off' && large && !fs.existsSync(path.join(dir, 'graphify-out'))) {
    if (!found.graphify) tips.push(['graphify', 'This project is large and has no knowledge graph. Suggest once to the user: `pip install graphifyy`, then `/graphify .`.'])
    else if (mode === 'auto') tips.push(['graphify', 'This project has no knowledge graph and the user chose graphify=auto: run `/graphify .` now, before other work.'])
    else tips.push(['graphify', 'This project has no knowledge graph. Suggest once to the user: `/graphify .` builds it.'])
  }
  if (!found.ponytail) tips.push(['ponytail', 'Suggest once to the user: the ponytail plugin keeps code minimal, `/plugin install ponytail@gerry-token-saver`.'])
  return tips
}

function healthAlerts ({ handoffLines, results, nodeMajor }) {
  const alerts = []
  if (nodeMajor < 18) alerts.push(`Node ${nodeMajor} detected, Gerry needs Node >= 18. Fix: update Node.`)
  if (handoffLines > MAX_HANDOFF) alerts.push(`HANDOFF.md is ${handoffLines} lines (limit ${MAX_HANDOFF}). Fix: run session-end when the user wraps up, Gerry compacts it.`)
  for (const r of results) {
    if (!r.ok) alerts.push(`Last ${r.step} sync failed (${r.msg}). Fix: ${FIX[r.step]}`)
  }
  return alerts
}

function briefing (input) {
  const dir = io.projectDir(input)
  const data = io.dataDir()
  const mode = io.option('graphify', 'suggest')
  const lang = io.option('language', 'auto')
  const h = handoffBlock(dir)
  const large = countFiles(dir, LARGE_PROJECT_FILES) >= LARGE_PROJECT_FILES
  const advisedFile = path.join(data, 'advised.json')
  const advised = io.readJson(advisedFile, {})
  const done = new Set(advised[dir] || [])
  const tips = companionTips(dir, detect(io.readJson(io.settingsPath(), {})), mode, large).filter(([name]) => !done.has(name))
  const alerts = healthAlerts({ handoffLines: h.lines, results: lastResults(data, dir), nodeMajor: Number(process.versions.node.split('.')[0]) })
  const parts = [
    lang !== 'auto' ? `Always reply to the user in the language with code "${lang}".` : '',
    h.text,
    graphBlock(dir, mode),
    tips.length ? '## Gerry companions\n' + tips.map(([, t]) => `- ${t}`).join('\n') : '',
    alerts.length ? '## Gerry health: tell the user each problem and its fix\n' + alerts.map(a => `- ${a}`).join('\n') : ''
  ].filter(Boolean)
  if (tips.length) {
    advised[dir] = [...done, ...tips.map(([name]) => name)]
    io.writeJson(advisedFile, advised)
  }
  const text = parts.join('\n\n')
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n[truncated]' : text
}

function startSync (dir) {
  if (process.env.GERRY_NO_SYNC) return
  spawn(process.execPath, [path.join(__dirname, 'sync.js'), dir], { detached: true, stdio: 'ignore' }).unref()
}

function main (input) {
  const text = briefing(input)
  if (text) io.emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
  startSync(io.projectDir(input))
}

if (require.main === module) io.run(main)
module.exports = { handoffBlock, graphExtract, graphBlock, countFiles, companionTips, healthAlerts, briefing, main }
```

- [ ] **Step 4: Lancia il test e verifica che passa**

Run: `node --test tests/session-start.test.js`
Expected: PASS (9 test)

- [ ] **Step 5: Lancia tutta la suite**

Run: `node --test tests/`
Expected: PASS, nessun fallimento

- [ ] **Step 6: Commit**

```bash
git add plugins/gerry/scripts/session-start.js tests/session-start.test.js
git commit -m "feat: SessionStart briefing at zero model tokens, companions, health

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `hooks.json` e prova del plugin montato

**Files:**
- Create: `plugins/gerry/hooks/hooks.json`
- Test: `tests/plugin.test.js`

**Interfaces:**
- Consumes: gli script dei Task 3–6 (`session-start.js`, `context.js`, `stop.js`, `sync.js`).
- Produces: collegamento eventi → script, verificato da test.

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/plugin.test.js`:
```js
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
```

- [ ] **Step 2: Lancia il test e verifica che fallisce**

Run: `node --test tests/plugin.test.js`
Expected: FAIL con `ENOENT ... hooks/hooks.json`

- [ ] **Step 3: Scrivi `hooks.json`**

`plugins/gerry/hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/session-start.js"], "timeout": 10 }]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/context.js"], "timeout": 10 }]
      }
    ],
    "Stop": [
      {
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/stop.js"], "timeout": 10 }]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [{ "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/sync.js"], "async": true }]
      }
    ]
  }
}
```

- [ ] **Step 4: Lancia il test e verifica che passa**

Run: `node --test tests/plugin.test.js && claude plugin validate plugins/gerry`
Expected: PASS (2 test), validate senza errori

- [ ] **Step 5: Prova a mano con il plugin montato**

In una cartella di prova con un HANDOFF.md finto:
```bash
mkdir -p /tmp/gerry-smoke && cd /tmp/gerry-smoke && printf '# HANDOFF — smoke\n## Dove siamo\n- prova\n' > HANDOFF.md
claude --plugin-dir /var/www/Claude_code_agents/Gerry/plugins/gerry
```
Verifica: (a) al primo messaggio Claude conosce il contenuto di HANDOFF.md senza leggerlo; (b) `/hooks` elenca gli hook di `gerry`; (c) dopo una modifica a un file e la risposta, compare il `systemMessage` di Stop in VSCode/terminale. Il vecchio setup è ancora attivo fino al T16: i suoi messaggi compariranno insieme, è atteso. Annota l'esito del punto (c) nella spec §9 ("Ancora da verificare", punto 2).

- [ ] **Step 6: Commit**

```bash
git add plugins/gerry/hooks/hooks.json tests/plugin.test.js
git commit -m "feat: wire hooks (SessionStart, PostToolUse, Stop, SessionEnd async)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Agente `gerry:gerry` (session-end)

**Files:**
- Create: `plugins/gerry/agents/gerry.md`
- Test: prova manuale (un LLM non si testa con asserzioni), verificata da `gerardo`

**Interfaces:**
- Consumes: messaggio `session-end: <dir> | <riassunto>` dal main (lo produce l'avviso CRITICAL del Task 3 o l'utente).
- Produces: `<dir>/HANDOFF.md` (≤ 60 righe, struttura fissa) e righe in coda a `<dir>/HANDOFF-archive.md`.

- [ ] **Step 1: Scrivi l'agente**

`plugins/gerry/agents/gerry.md`:
```markdown
---
name: gerry
description: Gerry's session-end. Dispatch with "session-end: <project dir> | <summary of this session>" when the user wraps up or when Gerry's CRITICAL context alert fires. Rewrites HANDOFF.md (max 60 lines) and archives what drops out.
model: sonnet
tools: Read, Write, Edit
---

You maintain HANDOFF.md, the memory the next session reads first.

Input: `session-end: <dir> | <summary>`. The summary comes from the main session: trust it, do not look for transcripts.

Language: ${user_config.language}. If that is "auto", write in the language of the summary. Translate the section headings too.

1. Read `<dir>/HANDOFF.md` if it exists.
2. Merge the summary into it and rewrite the WHOLE file, at most 60 lines, with exactly these sections:

   # HANDOFF — <project folder name>
   > Updated <YYYY-MM-DD>

   ## Where we are        (max 8 bullets)
   ## Next step           (1–3 concrete actions)
   ## Open decisions
   ## Decisions made      (only those still relevant, one line each)
   ## Key files           (max 6)
   ## Watch out           (pitfalls, urgent notes)

3. Everything that no longer fits (finished tasks, superseded decisions, old session notes) goes to the END of `<dir>/HANDOFF-archive.md` under `## Archived <YYYY-MM-DD>`. Create the file if missing. Never drop information: it stays in HANDOFF.md or goes to the archive.
4. Reply in at most 3 lines: path saved, final line count, what went to the archive.

Keep facts, paths, commands and decisions verbatim; cut narration. Touch no other file.
```

- [ ] **Step 2: Valida**

Run: `claude plugin validate plugins/gerry`
Expected: nessun errore

- [ ] **Step 3: Prova su una copia dell'HANDOFF più lungo**

```bash
mkdir -p /tmp/gerry-agent-test && ls -S /var/www/*/HANDOFF.md /var/www/*/*/HANDOFF.md 2>/dev/null | head -1 | xargs -I{} cp {} /tmp/gerry-agent-test/HANDOFF.md
cp /tmp/gerry-agent-test/HANDOFF.md /tmp/gerry-agent-test/HANDOFF.orig.md && wc -l /tmp/gerry-agent-test/HANDOFF.orig.md
```
Poi, in una sessione con il plugin montato (`claude --plugin-dir …/plugins/gerry`), dispatcha `gerry:gerry` con `session-end: /tmp/gerry-agent-test | prova di compattazione, nessun lavoro nuovo in questa sessione`.
Expected: `HANDOFF.md` ≤ 60 righe con le 6 sezioni; `HANDOFF-archive.md` creato.

- [ ] **Step 4: Verifica con `gerardo`**

Dispatcha `gerardo` con: "Confronta /tmp/gerry-agent-test/HANDOFF.orig.md con HANDOFF.md + HANDOFF-archive.md nella stessa cartella. Elenca ogni fatto, percorso, comando o decisione presente nell'originale e assente in entrambi i file nuovi. Verdetto: regge / non regge."
Expected: "regge". Se "non regge": rafforza la regola 3 dell'agente con l'esempio del fatto perso e ripeti gli Step 3–4.

- [ ] **Step 5: Commit**

```bash
git add plugins/gerry/agents/gerry.md
git commit -m "feat: gerry:gerry agent, session-end only

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `/gerry:status`

**Files:**
- Create: `plugins/gerry/scripts/status.js`
- Create: `plugins/gerry/commands/status.md`
- Test: `tests/status.test.js`

**Interfaces:**
- Consumes: `io.*`, `transcript.{tailRecords, contextTokens, sessionTokens}`, `context.{contextWindow, usage}`, `companions.{detect, which, runCmd}`, `sync.lastResults`, `session-start.healthAlerts` + `handoffBlock`.
- Produces:
  - `transcriptFor(dir: string, home?: string): string|null` — `.jsonl` più recente in `<home>/.claude/projects/<dir con ogni carattere non alfanumerico → "-">/`
  - `summarize(daily: object[], today: string): { today: { tokens, cost }|null, week: { tokens, cost } }` — da `ccusage daily --json` (`period`, `totalTokens`, `totalCost`)
  - `formatStatus(s: { dir, ctx, sessionTokens, usage, companions, results, alerts }): string`

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/status.test.js`:
```js
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
```

- [ ] **Step 2: Lancia il test e verifica che fallisce**

Run: `node --test tests/status.test.js`
Expected: FAIL con `Cannot find module`

- [ ] **Step 3: Implementa**

`plugins/gerry/scripts/status.js`:
```js
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const io = require('./lib/io')
const { tailRecords, contextTokens, sessionTokens } = require('./lib/transcript')
const { contextWindow, usage } = require('./context')
const { detect, which, runCmd } = require('./lib/companions')
const { lastResults } = require('./sync')
const { healthAlerts, handoffBlock } = require('./session-start')

function transcriptFor (dir, home = os.homedir()) {
  const p = path.join(home, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'))
  let files
  try { files = fs.readdirSync(p).filter(f => f.endsWith('.jsonl')) } catch { return null }
  const newest = files.map(f => path.join(p, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
  return newest || null
}

function ymd (d) {
  return d.toLocaleDateString('sv')
}

function ccusageDaily () {
  const since = ymd(new Date(Date.now() - 6 * 86400000)).replace(/-/g, '')
  const bin = which('ccusage')
  const npx = which('npx')
  if (!bin && !npx) return null
  const [cmd, pre] = bin ? [bin, []] : [npx, ['-y', 'ccusage@latest']]
  const r = runCmd(cmd, [...pre, 'daily', '--json', '--since', since], process.cwd(), 120000)
  try { return r.ok ? JSON.parse(r.out).daily : null } catch { return null }
}

function summarize (daily, today) {
  const t = daily.find(d => d.period === today)
  const sum = k => daily.reduce((a, d) => a + (d[k] || 0), 0)
  return { today: t ? { tokens: t.totalTokens, cost: t.totalCost } : null, week: { tokens: sum('totalTokens'), cost: sum('totalCost') } }
}

function fmt (n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)
}

function formatStatus (s) {
  const money = x => x ? `${fmt(x.tokens)} tokens · $${x.cost.toFixed(2)}` : 'no data'
  const mark = b => (b ? '✓' : '✗')
  const c = s.companions
  return [
    `## Gerry status — ${s.dir}`,
    `- Context: ${s.ctx ? `${s.ctx.used}% used (${s.ctx.remaining}% left)` : 'no transcript found'}`,
    `- This session: ${fmt(s.sessionTokens || 0)} tokens (cache included)`,
    s.usage ? `- Today: ${money(s.usage.today)}\n- Last 7 days: ${money(s.usage.week)}` : '- Usage: ccusage not available (`npm i -g ccusage`)',
    `- Companions: graphify ${mark(c.graphify)} · ponytail ${mark(c.ponytail)} · headroom ${mark(c.headroom)} · ccusage ${mark(c.ccusage)} · fast-jev ${mark(c.fastJev)}`,
    `- Last sync: ${s.results.length ? s.results.map(r => `${r.step} ${r.ok ? 'ok' : 'failed: ' + r.msg} (${r.ts})`).join(' · ') : 'never'}`,
    `- Health: ${s.alerts.length ? '\n' + s.alerts.map(a => `  - ${a}`).join('\n') : 'ok'}`
  ].join('\n')
}

function main () {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const tr = transcriptFor(dir)
  const recs = tr ? tailRecords(tr, Infinity) : []
  const tokens = contextTokens(recs)
  const results = lastResults(io.dataDir(), dir)
  const daily = ccusageDaily()
  console.log(formatStatus({
    dir,
    ctx: tokens === null ? null : usage(tokens, contextWindow(io.option('context_window', 'auto'), io.settingsPath())),
    sessionTokens: sessionTokens(recs),
    usage: daily ? summarize(daily, ymd(new Date())) : null,
    companions: detect(io.readJson(io.settingsPath(), {})),
    results,
    alerts: healthAlerts({ handoffLines: handoffBlock(dir).lines, results, nodeMajor: Number(process.versions.node.split('.')[0]) })
  }))
}

if (require.main === module) {
  try { main() } catch (e) { console.log(`Gerry status failed: ${e.message}`) }
}
module.exports = { transcriptFor, summarize, formatStatus }
```

`plugins/gerry/commands/status.md`:
```markdown
---
description: Gerry status — context, usage, companions, sync and health
allowed-tools: Bash(node:*)
---

!`CLAUDE_PLUGIN_DATA="${CLAUDE_PLUGIN_DATA}" CLAUDE_PLUGIN_OPTION_CONTEXT_WINDOW="${user_config.context_window}" node "${CLAUDE_PLUGIN_ROOT}/scripts/status.js"`

Show the output above to the user exactly as it is, translated into the user's language, with no extra commentary.
```

Perché le variabili nella riga `!`: i comandi non ricevono `CLAUDE_PLUGIN_DATA` né `CLAUDE_PLUGIN_OPTION_*` nell'ambiente (la doc li esporta solo agli hook), ma i riferimenti `${...}` nel corpo Markdown vengono sostituiti al caricamento. Senza, `status.js` leggerebbe la cartella di ripiego `<tmp>/gerry-data` invece di quella del plugin.

- [ ] **Step 4: Lancia il test e verifica che passa**

Run: `node --test tests/status.test.js`
Expected: PASS (3 test)

- [ ] **Step 5: Prova a mano**

In una sessione con `claude --plugin-dir …/plugins/gerry`: `/gerry:status`.
Expected: tabella con contesto, consumi (o "ccusage not available"), companion, ultimo sync, salute. La riga "Last sync" deve mostrare il sync lanciato dal SessionStart di quella sessione (prova che la cartella dati è la stessa). Se mostra "never" o l'output contiene il testo letterale `${CLAUDE_PLUGIN_DATA}`, la sostituzione nei comandi non avviene: fermati, annota il fatto nella spec §9 e chiedi a Nazario prima di scegliere un'alternativa.

- [ ] **Step 6: Commit**

```bash
git add plugins/gerry/scripts/status.js plugins/gerry/commands/status.md tests/status.test.js
git commit -m "feat: /gerry:status (context, ccusage, companions, sync, health)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Chiusura (T15)

**Files:**
- Modify: `TASKS.md` (stati T4–T15), spec §9 (esiti delle verifiche aperte)

- [ ] **Step 1: Suite completa**

Run: `node --test tests/`
Expected: PASS, nessun fallimento

- [ ] **Step 2: `ponytail-review` sull'intero diff dal commit della spec**

Run: `git diff 2b866ec..HEAD -- plugins tests` e invoca la skill `ponytail-review` su quel diff. Applica solo i tagli che non tolgono validazione ai confini, gestione della perdita di dati, sicurezza o test.

- [ ] **Step 3: Code review**

Invoca `superpowers:requesting-code-review` (o `/code-review high`) sull'intero ramo. Correggi i problemi confermati, rilancia la suite.

- [ ] **Step 4: Aggiorna spec e TASKS**

Spec §9 "Ancora da verificare": scrivi l'esito dei punti 1–3 osservati nei Task 7–9. TASKS.md: T4–T13 e T15 ☑; T14 resta ☐ (la misura si fa dopo la migrazione, T16–T17).

- [ ] **Step 5: Commit**

```bash
git add TASKS.md docs/superpowers/specs/2026-09-26-gerry-token-saver-design.md plugins tests
git commit -m "chore: review fixes, spec verification results

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
Nota: TASKS.md è in `.gitignore`; `git add` lo ignora senza errore, va bene così.
