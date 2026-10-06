import { main } from './cli.mjs';
export const apiVersion = 1;
export default function activate() {
  return { commands: { editor: { usage: 'editor [start|url|message|state|claude] — authenticated local browser editor', async run(ws, argv) {
    const verb = ['start', 'url', 'message', 'state', 'claude'].includes(argv[0]) ? argv[0] : 'start';
    await main([verb, ws.root, ...(argv[0] === verb ? argv.slice(1) : argv)]);
    return 0;
  } } } };
}
