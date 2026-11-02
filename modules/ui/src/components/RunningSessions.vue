<!--
	THE RUNNING SESSIONS (cr-vscode-005, acceptance 3) — atop the UNSCOPED Activity page: a session
	belongs to this machine, not to a module or a layer (design D6). From `GET /sessions/running`: every
	`sessions` record whose status is `running`, as stored, newest heartbeat first. Per session: who (the
	worker, else "a <harness> session"), when it started, how long since its heartbeat, the session linked;
	then each record it holds, linked by title, with core's own sentence about this session under it — so
	a session whose heartbeat went quiet reads "… the claim has lapsed" here as on the record's page. The
	age is the fact; nothing here judges staleness (design D5).
	`absent` (no sessions collection): nothing. `unreadable`: one line with the reason, and the commit feed
	below loads as before. Read once when the page opens.
-->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { relativeTime } from '../lib/relative-time';
import type { NextNote } from '../lib/next-notes';
import DtIcon from './DtIcon.vue';
import DtLink from './DtLink.vue';
import NoteText from './NoteText.vue';

interface RunningRecord { ref: string; collection?: string; id?: string; title?: string; notes: NextNote[] }
interface RunningSession { id: string; name: string; worker?: string; harness?: string; host?: string; started?: string; heartbeat?: string; records: RunningRecord[] }
interface Running { state: 'absent' | 'unreadable' | 'ok'; reason?: string; sessions: RunningSession[] }

const running = ref<Running | null>(null);

onMounted(async () => {
	try {
		const { data } = await api.get<Running>('/sessions/running');
		running.value = data && typeof data === 'object' && 'state' in data ? data : null;
	} catch {
		// the commit feed is the page; a failed sessions read draws no section rather than an error
		running.value = null;
	}
});

const who = (s: RunningSession) => s.worker ?? (s.harness ? `a ${s.harness} session` : 'a session');
const when = (v?: string) => {
	const d = v ? new Date(v) : null;
	return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : (v ?? '');
};
const age = (v?: string) => {
	const d = v ? new Date(v) : null;
	return d && !Number.isNaN(d.getTime()) ? relativeTime(d) : 'never';
};
</script>

<template>
	<section v-if="running && running.state !== 'absent'" class="dt-running-sessions" aria-label="Running sessions">
		<h3 class="dt-running-sessions__head">Running sessions</h3>
		<p v-if="running.state === 'unreadable'" class="dt-running-sessions__empty">Sessions cannot be read on this machine — {{ running.reason }}</p>
		<p v-else-if="!running.sessions.length" class="dt-running-sessions__empty">No session is running on this machine.</p>
		<article v-for="s in running.sessions" v-else :key="s.id" class="dt-running-sessions__session" :data-session="s.id">
			<div class="dt-running-sessions__line">
				<DtIcon class="dt-running-sessions__icon" name="broadcast" />
				<span class="dt-running-sessions__who">{{ who(s) }}</span>
				<DtLink class="dt-running-sessions__name" :to="`/content/sessions/${s.id}`">{{ s.name }}</DtLink>
				<span class="dt-running-sessions__started" :title="s.started">since {{ when(s.started) }}</span>
				<span class="dt-running-sessions__heartbeat" :title="s.heartbeat ?? 'no heartbeat recorded'">heartbeat {{ age(s.heartbeat ?? s.started) }}</span>
			</div>
			<ul v-if="s.records.length" class="dt-running-sessions__records">
				<li v-for="r in s.records" :key="r.ref" class="dt-running-sessions__record">
					<!-- the host sends `collection` only for a record this workspace holds; anything else is the bare ref -->
					<DtLink v-if="r.collection" :to="`/content/${r.ref}`">{{ r.title ?? r.ref }}</DtLink>
					<span v-else>{{ r.ref }}</span>
					<span v-for="(n, i) in r.notes" :key="i" class="dt-running-sessions__note"><NoteText :note="n" /></span>
				</li>
			</ul>
		</article>
	</section>
</template>

<style scoped>
.dt-running-sessions {
	margin: 0 0 16px;
	padding: 8px 12px;
	border: 1px solid var(--vscode-panel-border, var(--dt-border));
	border-radius: 4px;
}
.dt-running-sessions__head {
	margin: 0 0 6px;
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
}
.dt-running-sessions__empty {
	margin: 0;
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
}
.dt-running-sessions__session + .dt-running-sessions__session {
	margin-top: 8px;
}
.dt-running-sessions__line {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 8px;
}
.dt-running-sessions__icon {
	color: var(--vscode-charts-blue, var(--dt-color-charts-blue, var(--dt-unknown-color)));
}
.dt-running-sessions__who {
	font-weight: 600;
}
.dt-running-sessions__started,
.dt-running-sessions__heartbeat {
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
	font-size: 12px;
}
.dt-running-sessions__records {
	margin: 4px 0 0 22px;
	padding: 0;
	list-style: none;
}
.dt-running-sessions__record {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: baseline;
}
.dt-running-sessions__note {
	font-size: 12px;
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
}
</style>
