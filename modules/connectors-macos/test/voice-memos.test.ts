// CONNECTORS-MACOS: dt-voice-memos copies new Voice Memos into the recordings inbox. Measured on a
// synthetic store (a CloudRecordings.db made with the system's sqlite3) named by VOICE_MEMOS_STORE, so the
// helper and Full Disk Access are never involved; the package also installs and compiles its skill.
import { test, describe, before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { virginWorkspace, installPacked, closure, run, cleanup } from "../../../tests/helpers/workspace.ts"

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "dt-voice-memos")
const onMac = process.platform === "darwin" && spawnSync("sqlite3", ["-version"]).status === 0
const APPLE = 978307200

after(cleanup)

describe("dt-voice-memos on a synthetic store", { skip: !onMac && "macOS with sqlite3 only" }, () => {
  let dir, store, inbox, state, env
  const now = Math.floor(Date.now() / 1000) - APPLE
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dt-voice-memos-"))
    store = path.join(dir, "store")
    inbox = path.join(dir, "inbox")
    state = path.join(dir, "state.tsv")
    fs.mkdirSync(store)
    fs.mkdirSync(inbox)
    const rows = [
      ["u1", now - 3600, "New Recording 3", "a.m4a", 1, "NULL"],
      ["u2", now - 1800, "2026 11 17 0930 northwind weekly dana sam", "b.m4a", 1, "NULL"],
      ["u3", now - 900, "harbor mutual call", "c.m4a", 1, now], // Recently Deleted
      ["u4", now - 600, "personal note", "d.m4a", 2, "NULL"], // another folder
      ["u5", now - 86400 * 30, "last month", "e.m4a", 1, "NULL"], // before the window
      ["u6", now - 300, "still in icloud", "missing.m4a", 1, "NULL"], // no file on this Mac
    ]
    const sql = [
      "CREATE TABLE ZFOLDER(Z_PK INTEGER PRIMARY KEY, ZENCRYPTEDNAME TEXT)",
      "INSERT INTO ZFOLDER VALUES(1,'Meetings'),(2,'Personal')",
      "CREATE TABLE ZCLOUDRECORDING(ZUNIQUEID TEXT, ZDATE REAL, ZDURATION REAL, ZENCRYPTEDTITLE TEXT, ZPATH TEXT, ZFOLDER INT, ZEVICTIONDATE REAL)",
      ...rows.map(([u, d, t, p, f, e]) => `INSERT INTO ZCLOUDRECORDING VALUES('${u}',${d},4,'${t}','${p}',${f},${e})`),
    ].join(";")
    assert.equal(spawnSync("sqlite3", [path.join(store, "CloudRecordings.db"), sql]).status, 0)
    for (const f of ["a", "b", "c", "d", "e"]) fs.writeFileSync(path.join(store, `${f}.m4a`), `audio ${f}`)
    env = { ...process.env, VOICE_MEMOS_STORE: store, VOICE_MEMOS_INBOX: inbox, VOICE_MEMOS_STATE: state }
  })
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const memos = (...args) => spawnSync(BIN, args, { env, encoding: "utf8" })
  const landed = () =>
    fs.existsSync(path.join(inbox, "meeting-recordings"))
      ? fs.readdirSync(path.join(inbox, "meeting-recordings")).sort()
      : []

  test("--dry-run lists the folder's new memos and copies nothing", () => {
    const r = memos("--dry-run", "--folder", "Meetings")
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /2 to copy/)
    assert.deepEqual(landed(), [])
  })

  test("copies the folder's new memos, dated, and leaves out deleted, old and other-folder ones", () => {
    const r = memos("--folder", "Meetings")
    assert.equal(r.status, 0, r.stderr)
    const files = landed()
    assert.equal(files.length, 2, files.join(", "))
    assert.ok(files.includes("2026 11 17 0930 northwind weekly dana sam.m4a"), "a dated title keeps its name")
    assert.ok(
      files.some(f => /^\d{4}-\d{2}-\d{2} \d{4} New Recording 3\.m4a$/.test(f)),
      "an undated title gets the start instant"
    )
    assert.ok(!files.some(f => /harbor|last month|personal/.test(f)))
    assert.match(r.stderr, /not on this Mac yet/)
  })

  test("a second run copies nothing again", () => {
    const r = memos("--folder", "Meetings")
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /0 copied, 2 already copied/)
    assert.equal(landed().length, 2)
  })
})

test("off a Mac it says so and stops", { skip: process.platform === "darwin" && "runs on Linux CI" }, () => {
  const r = spawnSync("bash", [BIN, "--dry-run"], { encoding: "utf8" })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /macOS only/)
})

test("installs with recordings and compiles the importing-voice-memos skill", () => {
  const root = virginWorkspace()
  installPacked(root, [...closure("connectors-macos")])
  const c = run(root, ["compile"])
  assert.equal(c.status, 0, `${c.stdout}\n${c.stderr}`)
  assert.ok(fs.existsSync(path.join(root, ".dreamteamer", "skills", "importing-voice-memos", "SKILL.md")))
})
