<!-- Per-render fault isolation (Directus research item 4): a broken View/Edit component
     degrades to the fallback slot instead of blanking the table/form. onErrorCaptured
     returns false so the error never propagates to the app root. -->
<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';
const props = defineProps<{ name: string }>();
const failed = ref(false);
onErrorCaptured((err) => {
	if (!failed.value) console.warn(`[render] '${props.name}' threw — degrading to fallback`, err);
	failed.value = true;
	return false;
});
</script>

<template>
	<slot v-if="!failed" />
	<slot v-else name="fallback" />
</template>
