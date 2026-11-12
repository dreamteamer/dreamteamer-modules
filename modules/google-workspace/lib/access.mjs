import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './client.mjs';

// Unknown tools fail closed, including tools whose name merely starts with "get".
export const READ_TOOLS = new Set([
  'search_gmail_messages', 'get_gmail_message_content', 'get_gmail_messages_content_batch',
  'list_calendars', 'get_events', 'search_drive_files', 'get_drive_file_content',
]);
export function validateCall(account, tool, args = {}, allowWrite = false) {
  if (typeof account !== 'string' || !/^[A-Za-z0-9.!#$%&'*+_=~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(account)) throw new Error('An explicit valid account email is required.');
  if (!tool || typeof tool !== 'string') throw new Error('A tool name is required.');
  if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Tool arguments must be a JSON object.');
  if (Object.hasOwn(args, 'user_google_email') && args.user_google_email !== account) throw new Error('Tool account does not match the explicitly selected account.');
  if (!READ_TOOLS.has(tool) && !allowWrite) throw new Error('Tool is not in the read-only allowlist. Obtain approval before using --allow-write.');
  return { ...args, user_google_email: account };
}
export function configuration(env = process.env) {
  for (const key of ['GOOGLE_CLIENT_SECRET_PATH', 'WORKSPACE_MCP_CREDENTIALS_DIR']) {
    if (!env[key] || !path.isAbsolute(env[key])) throw new Error(`${key} must be an absolute local path.`);
  }
  // Deliberately do not inherit application secrets, proxy settings, runtime injection,
  // alternative credential stores, service accounts or remote callback configuration.
  const runtime = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'LANG', 'LC_ALL', 'TZ']) {
    if (typeof env[key] === 'string') runtime[key] = env[key];
  }
  return {
    ...runtime,
    GOOGLE_CLIENT_SECRET_PATH: env.GOOGLE_CLIENT_SECRET_PATH,
    WORKSPACE_MCP_CREDENTIALS_DIR: env.WORKSPACE_MCP_CREDENTIALS_DIR,
    WORKSPACE_MCP_CREDENTIAL_STORE_BACKEND: 'local_directory',
    WORKSPACE_MCP_TRANSPORT: 'stdio',
    WORKSPACE_MCP_BASE_URI: 'http://localhost',
    MCP_ENABLE_OAUTH21: 'false',
    EXTERNAL_OAUTH21_PROVIDER: 'false',
    TRUST_GATEWAY_IDENTITY: 'false',
    WORKSPACE_MCP_STATELESS_MODE: 'false',
    MCP_SINGLE_USER_MODE: '0',
    GOOGLE_SERVICE_ACCOUNT_KEY_FILE: '',
    GOOGLE_SERVICE_ACCOUNT_KEY_JSON: '',
    GOOGLE_OAUTH_CLIENT_ID: '',
    GOOGLE_OAUTH_CLIENT_SECRET: '',
    GOOGLE_OAUTH_REDIRECT_URI: '',
    WORKSPACE_EXTERNAL_URL: '',
    OAUTH_CUSTOM_REDIRECT_URIS: '',
    PYTHON_DOTENV_DISABLED: '1',
    UV_NO_CONFIG: '1',
    BROWSER: fileURLToPath(new URL('../bin/no-browser.mjs', import.meta.url)),
  };
}
export function credentialPath(directory, email) {
  // Match Python quote(email, safe="@._-") without allowing path traversal.
  const filename = encodeURIComponent(email).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%40/g, '@');
  return path.join(directory, `${filename}.json`);
}
export async function call({ account, tool, args = {}, allowWrite = false, env = process.env, connectionFactory = connect, fileExists = fs.existsSync }) {
  const arguments_ = validateCall(account, tool, args, allowWrite);
  const serverEnv = configuration(env);
  if (!fileExists(serverEnv.GOOGLE_CLIENT_SECRET_PATH)) throw new Error('OAuth client configuration is missing. Complete local setup first.');
  if (!fileExists(credentialPath(serverEnv.WORKSPACE_MCP_CREDENTIALS_DIR, account))) throw new Error('No stored credential for this account. Complete owner-controlled consent separately; no server call was made.');
  const client = connectionFactory({ env: serverEnv, args: ['--with', 'python-dotenv==1.2.3', 'workspace-mcp==2.4.2', '--transport', 'stdio', ...(allowWrite ? [] : ['--read-only'])] });
  try {
    await client.ready();
    const result = await client.send('tools/call', { name: tool, arguments: arguments_ });
    if (!result || result.isError) throw new Error('Google Workspace tool failed. Check authorization and arguments locally.');
    const text = (result.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (/Authentication Needed|ACTION REQUIRED|accounts\.google\.com\/o\/oauth2/i.test(text)) throw new Error('Account authorization needs attention. Complete consent separately; do not retry in a loop.');
    return result;
  } finally { client.close(); }
}
