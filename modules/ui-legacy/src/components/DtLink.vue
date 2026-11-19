<!--
	The app's one internal link. Every navigable value — a relation on the properties page, a
	breadcrumb crumb — goes through here so they all behave the same way:

	  plain click        → route in place (this tab follows, `dt:route` re-titles it)
	  ⌘/Ctrl click       → open in a NEW editor tab (operator ask 2026-07-29)
	  middle click       → same as ⌘, the browser convention

	Deliberately NOT `RouterLink`. Two reasons, both structural rather than stylistic:

	- RouterLink *ignores* modified clicks by design — it declines to navigate and lets the anchor's
	  default fire, which is right in a browser and wrong here: this app runs on a MEMORY history
	  inside a webview, so the default would navigate the whole document to a `vscode-webview://…`
	  URL that renders nothing and cannot be navigated back from. So the default has to be prevented
	  unconditionally, on every path, which means owning the click handler outright.
	- "New tab" isn't a thing the webview can do by itself — a VS Code editor tab is a host object.
	  The ⌘ path is a `dt:open` notification the extension answers with `AppTabs.open(route, {pin})`
	  (panel.ts), which focuses an existing tab already showing that content rather than opening a
	  duplicate — the same dedupe clicking an open file gets.

	It still renders a real `<a href>`, so hover/right-click/keyboard behave like a link.
-->
<script setup lang="ts">
import { useRouter } from 'vue-router';
import { hostNotify } from '../api/transport';

const props = defineProps<{ to: string }>();

const router = useRouter();

function onClick(event: MouseEvent): void {
	event.preventDefault();
	// A link can sit inside a clickable row (a card, a table row); the link's target wins.
	event.stopPropagation();
	if (event.metaKey || event.ctrlKey || event.button === 1) {
		hostNotify('dt:open', { route: props.to });
		return;
	}
	void router.push(props.to);
}
</script>

<template>
	<a class="dt-link" :href="to" @click="onClick" @auxclick.middle="onClick"><slot /></a>
</template>
