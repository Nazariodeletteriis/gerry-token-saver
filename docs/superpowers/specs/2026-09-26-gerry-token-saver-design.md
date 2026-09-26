# Gerry token-saver — Design

> Data: 2026-09-26 · Stato: in revisione · Autore: Nazario De Letteriis (con Claude)
> Design approvato sezione per sezione in chat (T1). Questo documento è la fonte per il piano (T3).
> Lingua: italiano per la revisione; il README pubblico sarà in inglese (T22).

## 1. Obiettivo

Trasformare Gerry, oggi un insieme di hook e un agente sparsi in `~/.claude/`, in un **plugin Claude Code pubblico** che:

- dà a ogni sessione la memoria della precedente (HANDOFF.md) **senza spendere token del modello** per caricarla;
- avvisa quando il contesto si riempie, **solo quando serve**;
- tiene HANDOFF.md **corto e stabile** (≤ 60 righe) senza perdere storia;
- collega companion esterni (graphify, ponytail, Headroom, ccusage) senza copiarli;
- si accorge da solo dei propri guasti e **propone la soluzione**.

### Successo misurabile

1. Token iniettati a inizio sessione: da ~29k (regole doppie) + ~25k (dispatch Gerry) a **≤ 10.000 caratteri**, zero chiamate a subagenti.
2. Dispatch di Gerry per sessione: da uno ogni 10 minuti a **0–1** (solo session-end).
3. HANDOFF di tutti i progetti ≤ 60 righe dopo il primo session-end.
4. Nessun falso allarme dello Stop hook in cartelle non git.
5. Numeri prima/dopo misurati con `scripts/measure_usage.py`, pubblicati nel README.

### Fuori scope

- wayfinder (resta agente personale di Nazario, T18).
- Integrazione fast-jev-compaction (solo menzione nel README, T24 in attesa).
- Mini-monitor desktop (T25, dopo v1).
- Fix di `plan-enter.sh` / `plan-exit.sh` e hook GSD (personali, T20–T21).

## 2. Struttura repo e plugin

```
gerry-token-saver/                  ← repo = marketplace
├── .claude-plugin/marketplace.json ← gerry (./plugins/gerry) + ponytail (github esterno)
├── plugins/gerry/                  ← unica cosa installata
│   ├── .claude-plugin/plugin.json  (+ userConfig)
│   ├── agents/gerry.md             → gerry:gerry
│   ├── hooks/hooks.json
│   ├── scripts/                    (session-start.js, context.js, stop.js, sync.js, status.js, lib/)
│   └── commands/status.md          → /gerry:status
├── docs/superpowers/specs/         ← spec e piani (non spediti)
├── docs/headroom-trial/            ← baseline e misure
├── scripts/measure_usage.py        ← misura prima/dopo (non spedito)
├── tests/                          ← node:test + fixture
├── README.md · LICENSE · CHANGELOG.md
└── .gitignore                      ← graphify-out/, HANDOFF.md, HANDOFF-archive.md, TASKS.md
```

**marketplace.json** elenca due plugin:
- `gerry` → `"source": "./plugins/gerry"`
- `ponytail` → `"source": {"source": "github", "repo": "DietrichGebert/ponytail"}` (ref fissato a un tag al rilascio)

graphify **non** è nel marketplace (è un pacchetto pip, `graphifyy`). fast-jev-compaction è solo nella sezione "Optional integrations" del README.

HANDOFF.md, HANDOFF-archive.md e TASKS.md di **questo** progetto sono la memoria di lavoro del Gerry attuale durante la costruzione: fuori da git (contengono percorsi personali; evitano l'autoreferenza).

## 3. Hook

**Runtime**: Node, solo libreria standard, nessuna dipendenza npm. Ogni script esce con codice 0 e output vuoto se qualcosa va storto (mai bloccare una sessione). Se `node` non è nel PATH, l'hook fallisce in silenzio; il README lo indica come requisito (Node ≥ 18).

**Forma**: hook in *exec form* (`command` + `args`) così i valori di config arrivano anche come `${user_config.KEY}`; gli script leggono comunque `CLAUDE_PLUGIN_OPTION_<KEY>` dall'ambiente.

**Stato persistente**: `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`, sopravvive agli aggiornamenti del plugin). Contiene: soglie già annunciate per sessione, companion già consigliati per progetto, cooldown Stop, log di sync.

### 3.1 SessionStart — briefing a zero token

Matcher: `startup`, `resume`, `clear`, `compact`. Output: `hookSpecificOutput.additionalContext`.

Contenuto, in quest'ordine, **totale < 10.000 caratteri** (oltre, Claude Code lo sposta in un file e mostra solo un'anteprima):

1. **Lingua** — una riga se `language` ≠ `auto` (es. "Rispondi in italiano").
2. **HANDOFF.md** — intero se ≤ 60 righe; altrimenti prime 60 righe + nota "HANDOFF a N righe, verrà compattato al prossimo session-end".
3. **Grafo** — una riga di stato (assente / presente / vecchio di N giorni) + se presente un estratto di ~20 righe da `graphify-out/GRAPH_REPORT.md` (nodi principali e comunità).
4. **Companion** — consigli per quelli mancanti, **una volta per progetto** (§6).
5. **Salute** — blocco avvisi del controllo di salute (§3.5), assente se tutto è ok.

Nessuna istruzione "dispatcha Gerry": il briefing è già il risultato.

In background (processo staccato, non attende): **recupero sync** (§3.4).

### 3.2 PostToolUse — percentuale di contesto

Porting di `gerry-checkpoint.js`, **senza timer**.

- Legge gli ultimi 512 KB del transcript (`transcript_path`), prende l'ultimo record con `message.usage` non `isSidechain`; token occupati = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- Finestra: config `context_window`. `auto` = 1.000.000 se il modello in `~/.claude/settings.json` contiene `[1m]`, altrimenti 200.000. Override env `GERRY_CTX_LIMIT` mantenuto.
- Percentuali "utilizzabili" come oggi (buffer auto-compact 10%).
- **Muto sotto soglia.** Una volta per soglia per sessione:
  - **AVVISO** a 60% usato → `additionalContext`: "Contesto al 60%. A fine task conviene chiudere la sessione." Il main lo riferisce all'utente in una riga.
  - **CRITICAL** a 30% rimanente → `additionalContext`: "Contesto quasi esaurito. Scrivi un riassunto vero della sessione e dispatcha `gerry:gerry` con `session-end: <dir> | <riassunto>`, poi proponi all'utente una nuova sessione."
- Soglie annunciate salvate in `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json`.

### 3.3 Stop — promemoria HANDOFF per l'utente

- **Niente git.** Dal transcript: ci sono stati `Edit`/`Write`/`NotebookEdit` in questa sessione su file diversi da HANDOFF.md, e HANDOFF.md non è stato modificato dopo l'ultima di queste modifiche (mtime)?
- Se sì e il cooldown (30 min per progetto) è scaduto → **`systemMessage`** all'utente: "📝 Gerry: file modificati in questa sessione, HANDOFF non aggiornato. Quando chiudi: 'chiudiamo' → session-end."
- **Mai `additionalContext` né `decision: block`**: su Stop fanno continuare la conversazione (è il difetto dell'hook attuale).
- Nessun HANDOFF.md nel progetto → silenzio.

### 3.4 SessionEnd + recupero — `sync.js`

Uno script, due chiamanti:
- **SessionEnd** con `async: true` (il budget sincrono di SessionEnd è 1,5 s).
- **SessionStart**, lanciato staccato: recupera se la chiusura precedente non ha fatto sync (es. tab VSCode chiusa, crash).

Cosa fa, confrontando date:
1. **Grafo** — se esiste `graphify-out/` e graphify è nel PATH e ci sono file di codice più recenti del grafo → `graphify . --update`. File di documentazione inclusi solo se `graphify_docs = true` (costano chiamate a un modello). Se `graphify = auto`, il progetto supera ~20 file o ~2.000 righe e il grafo non esiste → prima costruzione.
2. **Obsidian** — se `obsidian_vault` è impostato: copia `HANDOFF.md` → `<vault>/<progetto>/HANDOFF.md` e `graphify-out/obsidian/.` + `GRAPH_REPORT.md` → `<vault>/<progetto>/graph/`, solo se la sorgente è più recente. **Un solo vault** (registrato una volta dall'utente in Obsidian), progetti come sottocartelle; Gerry non tocca la configurazione di Obsidian. `<progetto>` = nome della cartella del progetto.
3. **Log** — esito di ogni passo in `${CLAUDE_PLUGIN_DATA}/sync-log.jsonl` (progetto, passo, ok/errore, messaggio, data). Lock per progetto per non far partire due sync insieme.

### 3.5 Controllo di salute

Dentro SessionStart, solo verifiche su file, nessuna chiamata al modello. Se tutto va bene non stampa nulla. Ogni avviso = **problema + soluzione pronta**.

| Controllo | Esempio di avviso |
|---|---|
| Ultimo sync fallito (log) | "Aggiornamento grafo fallito: graphify non trovato. Soluzione: `pip install graphifyy` o `graphify: off` in /config." |
| Grafo vecchio > 7 giorni con codice più recente | "Grafo vecchio di 12 giorni. Soluzione: `/graphify . --update`." |
| HANDOFF > 60 righe | "HANDOFF a 112 righe. Soluzione: 'chiudiamo' → Gerry lo compatta." |
| Vault Obsidian non raggiungibile | "Vault non trovato: <percorso>. Soluzione: correggi `obsidian_vault` in /config." |
| Node < 18 | "Node 16 rilevato, serve ≥ 18." |

## 4. Agente `gerry:gerry`

Un solo lavoro: **session-end**. File < 50 righe.

- Frontmatter: `model: sonnet`, `tools: Read, Write, Edit`.
- Chiamato dal main con `session-end: <dir> | <riassunto>`. **Il riassunto lo scrive il main** (ha il contesto); Gerry non rilegge il transcript.
- Passi:
  1. legge HANDOFF.md (se esiste) e il riassunto;
  2. riscrive HANDOFF.md con la struttura fissa (§5), ≤ 60 righe, nella lingua `${user_config.language}` (se `auto`, quella del riassunto);
  3. tutto ciò che esce (sessioni superate, decisioni chiuse, task fatti) va **in fondo** a `HANDOFF-archive.md` sotto `## Archiviato <data>`;
  4. risponde al main in ≤ 3 righe: salvato, righe finali, cosa è andato in archivio.
- Non fa: grafo, Obsidian (→ `sync.js`), session-start (→ hook), explore (→ agente Explore nativo), wayfinder (→ fuori scope).

## 5. HANDOFF

Struttura fissa:

```
# HANDOFF — <progetto>
> Aggiornato <data>

## Dove siamo          ≤ 8 punti
## Prossimo passo      1–3 azioni concrete
## Decisioni aperte
## Decisioni prese     solo quelle ancora rilevanti, una riga ciascuna
## File chiave         ≤ 6
## Attenzione          insidie, cose urgenti
```

Regole:
- **Riscritto, non accodato.** Limite 60 righe.
- **Niente si perde**: l'eccedenza va in `HANDOFF-archive.md`, mai iniettato, letto solo su richiesta.
- Gerry non modifica `.gitignore`.
- Migrazione dei 15 HANDOFF lunghi di Nazario (T19): **nessuno script**, si compattano al primo session-end di ciascun progetto.

## 6. Companion

Rilevamento nello hook SessionStart (solo shell, cache per sessione). Consiglio **una volta per progetto** (`${CLAUDE_PLUGIN_DATA}/advised.json`), poi silenzio.

| Companion | Rilevamento | Comportamento |
|---|---|---|
| graphify | `graphify` nel PATH | `suggest`: propone `/graphify .` una volta su progetti grandi; `auto`: prima costruzione via `sync.js`. Estratto ~20 righe nel briefing. `off`: niente. |
| ponytail | plugin abilitato in settings | Solo consiglio d'installazione dal marketplace. Una volta installato si autoattiva: Gerry non ha opzioni per ponytail. |
| Headroom | `ANTHROPIC_BASE_URL` punta a localhost e `headroom` nel PATH | Consiglio con i numeri della prova (fine 2026-09-29). Se la prova è negativa: nessun consiglio, solo menzione nel README. |
| ccusage | `ccusage` nel PATH o `npx` disponibile | Usato da `/gerry:status`. Nessun consiglio attivo. |
| fast-jev-compaction | plugin abilitato | Solo una riga in `/gerry:status`. |

### `/gerry:status`

Comando che esegue `scripts/status.js` e stampa una tabella, senza ragionamento del modello:
- contesto della sessione corrente in %;
- consumo oggi / settimana / sessione (da ccusage; se assente, la riga lo dice);
- stato di ogni companion;
- esito dell'ultimo sync e avvisi di salute aperti.

## 7. Config

Sistema nativo **`userConfig`** in `plugin.json`: Claude Code chiede i valori all'abilitazione, li salva in `pluginConfigs` di `settings.json`, li mostra in `/config` (v2.1.269+), li esporta agli hook come `CLAUDE_PLUGIN_OPTION_<KEY>` e li sostituisce in agenti come `${user_config.KEY}`.

| Chiave | Tipo | Valori | Default |
|---|---|---|---|
| `language` | string | `auto` o codice lingua | `auto` |
| `context_window` | string (options) | `auto`, `200000`, `1000000` | `auto` |
| `graphify` | string (options) | `off`, `suggest`, `auto` | `suggest` |
| `graphify_docs` | boolean | | `false` |
| `obsidian_vault` | directory | percorso, vuoto = spento | vuoto |

Fissi nel codice (diventano opzioni solo se richiesto): soglie 60% / 30%, limite 60 righe, cooldown 30 min, grafo "vecchio" = 7 giorni.

Config di Nazario: `language=it`, `context_window=auto`, `graphify=auto`, `graphify_docs=true`, `obsidian_vault=/mnt/c/Users/nazar/.claude/projects/Memory`.

**Versione minima di Claude Code**: 2.1.271 (`options` in userConfig). Da dichiarare nel README.

## 8. Test e misura

### Test automatici (`node --test`, `tests/`)

- **context.js**: transcript finti a 50% usato, 61% usato, 25% rimanente → muto / un solo avviso / un solo CRITICAL; record `isSidechain` ignorati; transcript troncato a metà riga.
- **stop.js**: Edit + HANDOFF vecchio → `systemMessage`; nessuna modifica → niente; cartella non git → niente falso allarme; cooldown rispettato; output mai con `additionalContext`/`decision`.
- **session-start.js**: HANDOFF 112 righe → 60 + nota; output < 10.000 caratteri; grafo assente / presente / vecchio; consiglio companion una volta sola; health check muto se tutto ok.
- **sync.js**: graphify finto nel PATH (successo / fallimento), vault in cartella temporanea, lock concorrente, errore finito nel log e poi nell'avviso di salute.
- **CI GitHub Actions**: Linux, macOS, Windows.

### Prova manuale dell'agente

session-end su una **copia** dell'HANDOFF più lungo di Nazario (712 righe) → HANDOFF ≤ 60 righe con struttura fissa + archivio. `gerardo` confronta originale con HANDOFF + archivio: nessun fatto importante perso.

### Misura del risparmio

`scripts/measure_usage.py` contro la baseline `docs/headroom-trial/baseline-2026-09-26.json` (30 sessioni, 252,7k token di contesto per chiamata), dopo ~1 settimana d'uso post-migrazione. Voci: token iniettati a inizio sessione, dispatch Gerry per sessione, token di contesto per chiamata. Headroom misurato separatamente (prova fino al 2026-09-29). Nel README solo numeri misurati.

### Prima del rilascio

`ponytail-review` sul diff + code review (T15).

## 9. Fatti verificati sulla documentazione (2026-09-26)

Fonti: code.claude.com/docs/en/hooks.md, plugins-reference.

- Un plugin spedisce insieme `agents/`, `commands/`, `skills/`, `hooks/hooks.json`. Nomi con prefisso: `gerry:gerry`, `/gerry:status`.
- `marketplace.json` accetta sorgenti relative e `{"source":"github","repo":...}`.
- Input comuni degli hook: `session_id`, `transcript_path` (scritto in modo asincrono, può essere leggermente indietro), `cwd`.
- `SessionStart` matcher: `startup`, `resume`, `clear`, `compact`, `fork`; `additionalContext` va nel contesto.
- `PostToolUse` accetta `hookSpecificOutput.additionalContext`.
- `Stop`: `additionalContext` e `decision: block` fanno **continuare** Claude; `systemMessage` è il campo universale mostrato all'utente.
- `SessionEnd`: reason `clear`, `resume`, `logout`, `prompt_input_exit`, `other`; budget 1,5 s condiviso, `async: true` lo aggira.
- Tetto 10.000 caratteri per `additionalContext` / `systemMessage` / stdout; oltre → file + anteprima di 2.000.
- `${CLAUDE_PLUGIN_DATA}` persiste tra aggiornamenti, cancellato alla disinstallazione (salvo `--keep-data`).
- Estensione VSCode di Nazario: 2.1.282 (CLI nel PATH: 2.1.114, da aggiornare o ignorare).

### Ancora da verificare durante la costruzione

1. `SessionEnd` scatta chiudendo la tab in VSCode? **Non bloccante**: il recupero al SessionStart copre il caso negativo.
2. `systemMessage` di uno Stop hook è visibile nel pannello VSCode (non solo nel terminale)? Se no, fallback: `terminalSequence` o notifica.
3. `${user_config.language}` viene sostituito nel corpo dell'agente anche quando vale `auto`.
