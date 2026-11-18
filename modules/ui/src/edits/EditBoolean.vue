<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
import type { FieldRow } from '../api/types';

defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	autofocus?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

function onUpdate(checked: boolean): void {
	emit('update:value', checked);
}
</script>

<template>
	<SwitchRoot class="dt-switch" :model-value="Boolean(value)" :autofocus="autofocus" @update:model-value="onUpdate">
		<SwitchThumb class="dt-switch-thumb" />
	</SwitchRoot>
</template>

<style scoped>
/* SIZED FROM TWO CUSTOM PROPERTIES so a dense surface can shrink it without a second component or a
   variant prop: a record form wants a switch you can hit, a 320px settings rail wants one that does
   not out-shout the setting it belongs to. An ancestor sets `--dt-switch-h` and everything else —
   thumb, travel, radius — follows from it.
   ⚠ The OFF track used to be `--dt-border-strong`, which resolved to the theme's focusBorder — the
   same blue as `--dt-accent` in most themes — so on and off rendered as one colour and the control
   could not be read at all. The token is a real neutral since 0.13.0; the fix is the token's, and
   this comment is here so nobody "helpfully" hard-codes a grey back in. */
.dt-switch {
	--_h: var(--dt-switch-h, 24px);
	--_w: var(--dt-switch-w, calc(var(--_h) * 1.8));
	--_pad: 2px;
	width: var(--_w);
	height: var(--_h);
	padding: var(--_pad);
	border-radius: 999px;
	background: var(--dt-border-strong);
	border: none;
	cursor: pointer;
	display: block;
	flex: 0 0 auto;
	transition: background-color 0.12s ease;
}
.dt-switch:focus-visible {
	outline: 1px solid var(--dt-focus-ring);
	outline-offset: 1px;
}
.dt-switch[data-state='checked'] {
	background: var(--dt-accent);
}
.dt-switch-thumb {
	display: block;
	width: calc(var(--_h) - var(--_pad) * 2);
	height: calc(var(--_h) - var(--_pad) * 2);
	border-radius: 50%;
	/* Not `#fff`: on a dark theme with a light button colour that was white-on-light. */
	background: var(--vscode-button-foreground, #fff);
	transition: transform 0.15s;
	transform: translateX(0);
}
.dt-switch-thumb[data-state='checked'] {
	transform: translateX(calc(var(--_w) - var(--_h)));
}
@media (prefers-reduced-motion: reduce) {
	.dt-switch,
	.dt-switch-thumb {
		transition: none;
	}
}
</style>
