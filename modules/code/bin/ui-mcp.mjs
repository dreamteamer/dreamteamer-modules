#!/usr/bin/env node
// Small stdio MCP adapter. Tools only navigate; all data edits stay with the Dreamteamer API/CLI.
import readline from 'node:readline';
import { callUi } from '../src/control.mjs';
const socket = process.env.DT_EDITOR_CONTROL_SOCKET;
const tools = [
  { name: 'editor_state', description: 'Read available Dreamteamer views, collections, open tabs and active app route.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'open_view', description: 'Show an internal Dreamteamer route. Use editor_state to discover saved views; /content/<collection>/<record> opens a record. List routes accept search, layout and filter query options.', inputSchema: { type: 'object', properties: { route: { type: 'string' }, pin: { type: 'boolean' } }, required: ['route'], additionalProperties: false } },
  { name: 'select_collection', description: 'Select and reveal a collection in the left navigation.', inputSchema: { type: 'object', properties: { collection: { type: 'string' } }, required: ['collection'], additionalProperties: false } },
  { name: 'open_file', description: 'Open a file inside this workspace in an editor tab.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, pin: { type: 'boolean' } }, required: ['path'], additionalProperties: false } },
];
const actions = { editor_state: 'state', open_view: 'open', select_collection: 'select', open_file: 'file' };
async function respond(message) {
  if (message.id === undefined) return;
  try {
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dreamteamer-editor', version: '0.1.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools };
    else if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (!Object.hasOwn(actions, name)) throw new Error('Unknown tool');
      try {
        if (!socket) throw new Error('Launch through dt-editor to connect UI tools');
        const value = await callUi(socket, { ...message.params.arguments, action: actions[name] });
        result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; }
    } else throw new Error('Unknown method');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch (e) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: e.message } }) + '\n'); }
}
const lines = readline.createInterface({ input: process.stdin });
for await (const line of lines) {
  try { if (line.length > 20000) throw new Error('Request too large'); await respond(JSON.parse(line)); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid request' } }) + '\n'); }
}
