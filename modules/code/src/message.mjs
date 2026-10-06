import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

// Keep stdin open after the sender's first turn, so its inbox remains available for the reply.
export async function messageCoordinator({ coordinator, text, workspace, timeout = 90000, executable = 'claude' }) {
  const requestId = randomUUID();
  const child = spawn(executable, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', 'ListAgents,SendMessage', '--allowedTools', 'ListAgents,SendMessage'], { cwd: workspace, stdio: ['pipe', 'pipe', 'inherit'] });
  const instruction = `You relay this user-authorized UI request to the single live session named ${coordinator}. Use ListAgents and SendMessage only. Do not perform the task yourself or message anyone else. Refuse missing or ambiguous targets. Include request ID ${requestId} and ask it to send its completion or failure back to your reply address. Request: ${JSON.stringify(text)}. After successful delivery, end this turn with exactly DELIVERY_PENDING. Do not poll. When the coordinator replies about ${requestId}, report its actual outcome to the user and end with REPLY_RECEIVED. If sending fails, report the failure and end without DELIVERY_PENDING.`;
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: instruction } }) + '\n');
  let pending = false, replied = false, resultError, exitCode;
  const exited = new Promise(resolve => { child.once('error', error => { resultError = error; resolve(); }); child.once('exit', code => { exitCode = code; resolve(); }); });
  const timer = setTimeout(() => { resultError = new Error(pending ? 'Delivered, but no coordinator reply arrived before the timeout. Inspect its chat or dt-editor state.' : 'Sender timed out before confirming delivery.'); child.kill('SIGTERM'); }, timeout);
  try {
    for await (const line of readline.createInterface({ input: child.stdout })) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type !== 'result') continue;
      const result = event.result ?? '';
      if (result.trim() === 'DELIVERY_PENDING' || (result.includes('DELIVERY_PENDING') && !result.includes('REPLY_RECEIVED'))) {
        pending = true; console.error('Delivered; waiting for the coordinator reply…'); continue;
      }
      console.log(result.replace(/REPLY_RECEIVED\s*$/, '').trim());
      replied = result.includes('REPLY_RECEIVED');
      if (!replied) resultError = new Error(event.is_error ? 'Sender failed.' : 'No confirmed coordinator reply.');
      child.stdin.end();
      break;
    }
    if (replied || resultError) child.kill('SIGTERM');
    await exited;
    if (resultError) throw resultError;
    if (!replied) throw new Error(`Sender exited before a coordinator reply (${exitCode}).`);
  } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGTERM'); }
}
