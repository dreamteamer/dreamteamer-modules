/**
 * ONE answer to "where are this reference's bytes", for every surface that draws them.
 *
 * ⚠ It exists because there were two. `GroupHeader.vue` resolved a file-codec reference to an <img>
 * src, and when `FileThumb.vue` needed the same thing it grew its own copy — the identical
 * fetch-then-re-check-identity dance, in a codebase whose own `record-cache.ts` header warns that
 * two answers to "what is this reference" is exactly what a shared cache exists to prevent. The
 * cache was shared; the logic around it was not, which is the version of that mistake that survives
 * review.
 *
 * ⚠ THE MID-FLIGHT IDENTITY RE-CHECK IS THE WHOLE POINT and is easy to leave out. The value can
 * change while the request is in the air — a table scrolls, a band regroups — and resolving the
 * PREVIOUS reference's src into the current row draws one record's picture on another. So the
 * result is dropped unless the reference is still the one that was asked for.
 */
import { computed, ref, watchEffect, type Ref } from 'vue';
import { fileRecordRef, srcForRecord, isImageExt } from './file-record';
import { fetchRecord } from './record-cache';

/**
 * `src` is non-null only once the record has arrived AND its extension is one an `<img>` can draw.
 * A non-image file record (a PDF, a font) resolves to null on purpose: an `<img>` at one is a broken
 * icon where the caller's own fallback would have been useful.
 *
 * `isFile` says whether the value is a file reference AT ALL, which a caller needs before the fetch
 * lands — it decides whether to reserve space for a picture or render the value as it always did.
 */
export function useFileSrc(value: () => unknown): { src: Ref<string | null>; isFile: Ref<boolean> } {
	const target = computed(() => (typeof value() === 'string' ? fileRecordRef(value() as string) : null));
	const src = ref<string | null>(null);

	watchEffect(() => {
		const want = target.value;
		src.value = null;
		if (!want) return;
		void fetchRecord(want.collection, want.id).then((record) => {
			if (target.value?.collection !== want.collection || target.value?.id !== want.id) return;
			const ext = record?.['ext'];
			if (!isImageExt(typeof ext === 'string' ? ext : null)) return;
			src.value = srcForRecord(want.collection, want.id, ext);
		});
	});

	return { src, isFile: computed(() => target.value !== null) };
}
