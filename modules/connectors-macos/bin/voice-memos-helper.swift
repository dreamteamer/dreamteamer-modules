// voice-memos-helper — the one program granted Full Disk Access to read the Voice Memos store.
// It copies the store's database files and the audio files modified since a given instant into a
// staging folder, and nothing else: no network, no child process, no write to the store.
// dt-voice-memos builds it once and starts it as a one-shot launchd job, so the grant
// belongs to this binary alone — not to Terminal, the editor or an agent session.
//
//   voice-memos-helper <store dir> <staging dir> <since, unix seconds>
// Writes <staging>/.done holding "ok <n>" or "error <message>".
import Foundation

let args = CommandLine.arguments
guard args.count == 4, let since = Double(args[3]) else {
	FileHandle.standardError.write("usage: voice-memos-helper <store> <staging> <since-unix-seconds>\n".data(using: .utf8)!)
	exit(2)
}
let store = args[1], dest = args[2]
let fm = FileManager.default
let done = dest + "/.done"

do {
	try fm.copyItem(atPath: store + "/CloudRecordings.db", toPath: dest + "/CloudRecordings.db")
	for side in ["CloudRecordings.db-wal", "CloudRecordings.db-shm"] where fm.fileExists(atPath: store + "/" + side) {
		try fm.copyItem(atPath: store + "/" + side, toPath: dest + "/" + side)
	}
	var copied = 0
	for name in try fm.contentsOfDirectory(atPath: store) where name.hasSuffix(".m4a") || name.hasSuffix(".qta") {
		let src = store + "/" + name
		let attrs = try fm.attributesOfItem(atPath: src)
		if let modified = attrs[.modificationDate] as? Date, modified.timeIntervalSince1970 >= since {
			try fm.copyItem(atPath: src, toPath: dest + "/" + name)
			copied += 1
		}
	}
	try "ok \(copied)\n".write(toFile: done, atomically: true, encoding: .utf8)
} catch {
	try? "error \(error.localizedDescription)\n".write(toFile: done, atomically: true, encoding: .utf8)
	exit(1)
}
