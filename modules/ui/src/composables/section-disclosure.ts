/**
 * Which COLLAPSED form sections the operator has opened on this page (`display.form.sections[].
 * collapsed`, engine after 0.39.1). A collapsed section starts shut; its heading is a toggle. Shared by
 * both record layouts — `ItemProperties` and `ItemForm` — so the two cannot disagree about what is
 * shut. Page-local on purpose: a fresh record page starts with the provenance block out of the way.
 */
import { ref } from 'vue';
import type { FormSection } from '../lib/field-row';

export function useSectionDisclosure() {
	const opened = ref(new Set<string>());
	return {
		isShut: (section: FormSection): boolean => section.collapsed === true && !opened.value.has(section.title),
		toggle(section: FormSection): void {
			const next = new Set(opened.value);
			if (next.has(section.title)) next.delete(section.title);
			else next.add(section.title);
			opened.value = next;
		},
	};
}
