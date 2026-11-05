// The webview is a thin host of @dreamteamer/ui: the VS Code entry, its postMessage transport and the
// theme mapping onto the editor's variables. The app itself — every page, list, edit and composable —
// lives in the package, and a copy left here would drift from it unseen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const files = (dir: string): string[] =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.relative(SRC, path.join(dir, e.name))]));
const SRC = path.join(process.cwd(), 'webview', 'src');

test('webview/src holds the entry, the transport and vscode.css — nothing of the app', () => {
	assert.deepEqual(files(SRC).sort(), ['main.ts', 'transport.ts', 'vscode.css']);
});

test('the entry mounts @dreamteamer/ui over the transport, with its stylesheet before vscode.css', () => {
	const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
	assert.match(main, /from '@dreamteamer\/ui'/);
	const lib = main.indexOf('@dreamteamer/ui/dist/lib/style.css');
	assert.ok(lib >= 0 && lib < main.indexOf('./vscode.css'), 'vscode.css must follow the library stylesheet so it maps the tokens');
	assert.ok(!fs.existsSync(path.join(process.cwd(), 'webview', 'browser.html')), 'the browser page is @dreamteamer/ui\'s, not the extension\'s');
});
