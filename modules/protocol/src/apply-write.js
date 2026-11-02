// Runs a gate decision's call, then — only when it answered 2xx and the decision carries one — the one commit by id.
/** @param {(method: string, path: string, body?: unknown) => Promise<{status: number, body: any}>} handle */
export async function applyWrite(handle, decision) {
	const { method, path, query, body, collection } = decision.call;
	const qs = new URLSearchParams(query ?? {}).toString();
	const answer = await handle(method, qs ? `${path}?${qs}` : path, body);
	if (answer.status < 200 || answer.status > 299 || !decision.commit) return answer;
	const only = decision.commit.only ?? [`${collection}/${answer.body?.id}`];
	await handle('POST', '/commit', { only, message: decision.commit.message.replace('<new>', String(answer.body?.id)) });
	return answer;
}
