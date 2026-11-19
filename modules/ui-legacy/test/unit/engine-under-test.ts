// The engine a package test loads when it needs real presentation rows: the repository's own
// convention — `DT_ENGINE_DIR`, else the root devDependency (`node_modules/dreamteamer`, the floor the
// package declares). Only a checkout carrying the public API (`src/api.js`) counts; an explicit
// `DT_ENGINE_DIR` that is not one fails rather than skips.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hasApi = (dir: string) => fs.existsSync(path.join(dir, 'src', 'api.js'));

function find(): string | undefined {
	const asked = process.env.DT_ENGINE_DIR ?? process.env.DT_ENGINE;
	if (asked) {
		if (!hasApi(asked)) throw new Error(`DT_ENGINE_DIR=${asked} is not a dreamteamer checkout with the public API (no src/api.js)`);
		return asked;
	}
	const here = path.dirname(fileURLToPath(import.meta.url));
	const root = path.resolve(here, '..', '..', '..', '..');
	return [path.join(root, 'node_modules', 'dreamteamer'), path.join(process.cwd(), 'node_modules', 'dreamteamer')].find(hasApi);
}

export const ENGINE = find();
export const NO_ENGINE = !ENGINE && 'no engine with the public API found (set DT_ENGINE_DIR=/path/to/dreamteamer)';
