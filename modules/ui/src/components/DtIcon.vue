<!--
	The app's ONE icon. Renders a codicon — VS Code's own set, which the native tree also draws, so
	a descriptor's `icon:` means the same thing on both sides of the postMessage boundary.

	`name` takes a codicon name; a legacy Material Symbols name still resolves through
	`codiconFor` (@dreamteamer/protocol's host/icon-name — shared with the native tree, so both halves agree) so a workspace authored before the switch keeps its icons.

	Why a component rather than a bare `<span class="codicon codicon-x">`: 127 call sites, 23 of
	them dynamic. A component is the one place the legacy translation and the empty-name fallback
	live, and it keeps every site the same shape whether its name is a literal or an expression.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { codiconFor } from '@dreamteamer/protocol/host/icon-name';

const props = defineProps<{ name?: string | null }>();
const glyph = computed(() => codiconFor(props.name));
</script>

<template>
	<span class="codicon" :class="`codicon-${glyph}`" aria-hidden="true"></span>
</template>
