<script setup lang="ts">
/**
 * The toast stack (cr-modules-022): bottom-right of the window, newest last. A white card with a tinted icon tile, the
 * sentence, the host's own words beneath it for an error, and a close button. Drawn only by the browser host's shell.
 */
import { dismissToast, toasts } from '../lib/toasts';
import DtIcon from './DtIcon.vue';

const ICON = { success: 'check', error: 'error', info: 'info' } as const;
</script>

<template>
	<div class="dt-toasts" aria-live="polite">
		<TransitionGroup name="dt-toast">
			<div v-for="t in toasts" :key="t.id" class="dt-toast" :class="`dt-toast--${t.kind}`" :role="t.kind === 'error' ? 'alert' : 'status'">
				<span class="dt-toast__tile"><DtIcon :name="ICON[t.kind]" /></span>
				<div class="dt-toast__text">
					<p class="dt-toast__line">{{ t.text }}</p>
					<p v-if="t.detail" class="dt-toast__detail">{{ t.detail }}</p>
				</div>
				<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm dt-toast__close" title="Dismiss" aria-label="Dismiss" @click="dismissToast(t.id)">
					<DtIcon name="close" />
				</button>
			</div>
		</TransitionGroup>
	</div>
</template>

<style scoped>
.dt-toasts {
	position: fixed;
	right: var(--dt-space-4);
	bottom: var(--dt-space-4);
	z-index: calc(var(--dt-z-menu) + 1);
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: var(--dt-space-2);
	pointer-events: none;
}
.dt-toast {
	pointer-events: auto;
	display: flex;
	align-items: flex-start;
	gap: var(--dt-space-3);
	width: min(360px, calc(100vw - 32px));
	padding: var(--dt-space-3);
	background: var(--dt-surface);
	border-radius: var(--dt-radius-xl);
	box-shadow: var(--dt-shadow-menu);
	color: var(--dt-fg);
}
.dt-toast__tile {
	flex: none;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: var(--dt-radius-lg);
	background: var(--dt-accent-tint);
	color: var(--dt-accent);
}
.dt-toast--success .dt-toast__tile {
	background: color-mix(in srgb, var(--dt-success) 16%, transparent);
	color: var(--dt-success);
}
.dt-toast--error .dt-toast__tile {
	background: color-mix(in srgb, var(--dt-danger) 14%, transparent);
	color: var(--dt-danger);
}
.dt-toast__text {
	flex: 1;
	min-width: 0;
	padding-top: 5px;
}
.dt-toast__line {
	font-weight: var(--dt-weight-medium);
	line-height: var(--dt-leading-tight);
}
.dt-toast__detail {
	margin-top: var(--dt-space-1);
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text-sm);
	overflow-wrap: anywhere;
}
.dt-toast__close {
	flex: none;
}
.dt-toast-enter-active,
.dt-toast-leave-active {
	transition:
		transform var(--dt-dur-med) var(--dt-ease),
		opacity var(--dt-dur-med) var(--dt-ease);
}
.dt-toast-enter-from,
.dt-toast-leave-to {
	transform: translateY(8px);
	opacity: 0;
}
</style>
