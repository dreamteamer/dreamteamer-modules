<!--
	A file-codec reference, drawn as the picture it is.

	A record of a `codec: file` collection is addressed by a plain string — `assets/avatars/ann`,
	`assets/logos/acme` — and every surface that met one rendered it as those 19 characters. The
	bytes were right there; nothing asked for them.

	⚠ IT DECIDES BY THE VALUE, NOT BY THE FIELD, and that is what makes it safe. `fileRecordRef`
	matches only against the file-codec collections the HOST injected, so a string that resolves is a
	file record by construction and nothing else can be mistaken for one. There is no heuristic here
	to be wrong about — which matters, because the alternative (a `viewer: image` on the field)
	is unreachable: the engine has no way for a descriptor to declare a field's View, so `ViewImage`
	has never been selectable in this product at all.

	Non-image files keep their reference as text: a PDF is a file record too, and an <img> at one is
	a broken icon where a filename would have been useful.
-->
<script setup lang="ts">
import { useFileSrc } from '../../lib/use-file-src';

const props = defineProps<{ value: string; alt?: string }>();

// The shared resolver — same one `GroupHeader` uses, so the two can never disagree about where a
// reference's bytes are or about dropping a result whose value changed mid-flight.
const { src } = useFileSrc(() => props.value);
</script>

<template>
	<img v-if="src" :src="src" :alt="alt ?? ''" class="dt-file-thumb" />
	<span v-else class="dt-file-thumb__text">{{ value }}</span>
</template>

<style>
/* Sized to sit ON A LINE OF TEXT — a template puts this beside a name, inside a table cell, inside a
   tooltip. `1.6em` follows whatever type scale the surface set rather than pinning a pixel size that
   is right in one place and wrong in the other two. */
.dt-file-thumb {
	width: 1.6em;
	height: 1.6em;
	object-fit: cover;
	border-radius: 50%;
	vertical-align: -0.45em;
	margin-right: 0.25em;
	background: var(--vscode-editorWidget-background, var(--dt-bg-subtle));
}
.dt-file-thumb__text {
	white-space: nowrap;
}
</style>
