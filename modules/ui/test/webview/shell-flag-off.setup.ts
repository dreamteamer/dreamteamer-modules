// First import of shell-flag-off.test.ts: the host as the VS Code extension leaves it — no window.__DT_HOST__ at all.
import { installHost } from './shell-host-globals';
installHost(undefined);
