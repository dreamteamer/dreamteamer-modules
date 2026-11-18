<!--
	THE REMOTE MARK (cr-vscode-012) — what a source's REMOTE grants, beside the local mark (SourceMark's
	pencil or lock, which says only whether THIS window writes the files). Computed live by the host
	(`src/remote-access.ts`) as the account the remote pushes as; nothing is stored.

	One line of words, never a lone glyph: `remote write · as <account>`. A WARNING only when all three
	hold — the local mark writes (write · edit), the remote level is below write, and the answer is tied
	to the push key — because then a push is refused before it happens. An answer that could not be tied
	(gh's active account on an https remote, a Bitbucket credential whose key is not the push key) says
	so and draws no warning it cannot stand behind.
-->
<script setup lang="ts">
import { computed } from 'vue';
import DtIcon from './DtIcon.vue';
import type { OwnAccess, SourceAccess } from '../api/types';

const props = defineProps<{
	/** The source's name — `data-source`, so a test and a reader find the mark by it. */
	source: string;
	/** The host's answer; undefined while it is being asked. */
	access?: OwnAccess | null;
	/** The LOCAL mark's access (`write · edit · read`). */
	local?: SourceAccess;
}>();

const PROVIDER: Record<string, string> = { github: 'GitHub', bitbucket: 'Bitbucket' };
const UNCONFIRMED = "the push key's account could not be confirmed";

const view = computed<{ state: string; words: string; title: string; warning: boolean }>(() => {
	const a = props.access;
	if (!a) return { state: 'checking', words: 'remote …', title: 'asking the remote', warning: false };
	const where = a.remote ? `${a.remote.owner}/${a.remote.repo}` : '';
	const hover = [a.remote ? `${PROVIDER[a.remote.provider] ?? a.remote.provider}: ${a.role ?? a.level ?? a.state} on ${where}` : '', a.reason ?? '', a.note ?? ''].filter(Boolean);
	if (a.state === 'ok') {
		const writesHere = props.local === 'write' || props.local === 'edit';
		const below = a.level === 'read' || a.level === 'none';
		if (writesHere && below && a.tiedToPushKey) return { state: 'ok', words: `push refused — ${a.account} has ${a.level} on ${where}`, title: hover.join(' · '), warning: true };
		if (writesHere && below) return { state: 'ok', words: `remote ${a.level} · as ${a.account} (${UNCONFIRMED})`, title: [...hover, UNCONFIRMED].join(' · '), warning: false };
		return { state: 'ok', words: `remote ${a.level} · as ${a.account}`, title: [...hover, ...(a.tiedToPushKey === false ? [UNCONFIRMED] : [])].join(' · '), warning: false };
	}
	if (a.state === 'no-access') return { state: a.state, words: `no access — ${a.reason ?? where}`, title: hover.join(' · '), warning: true };
	if (a.state === 'no-login') return { state: a.state, words: a.reason ?? 'no login', title: hover.join(' · '), warning: false };
	if (a.state === 'not-checked') return { state: a.state, words: `remote not checked — ${a.reason ?? ''}`, title: hover.join(' · '), warning: false };
	return { state: a.state, words: `remote unknown — ${a.reason ?? ''}`, title: hover.join(' · '), warning: false };
});
</script>

<template>
	<span class="dt-remote-access" :class="{ 'is-warning': view.warning }" :data-source="source" :data-state="view.state" :title="view.title">
		<DtIcon :name="view.warning ? 'warning' : 'cloud'" />
		<span class="dt-remote-access__words">{{ view.words }}</span>
	</span>
</template>

<style scoped>
.dt-remote-access {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
}
.dt-remote-access.is-warning {
	color: var(--dt-warning);
}
</style>
