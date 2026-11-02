export const FRAME_POLICY: string;
export function buildFrameDocument(input: {
	guestText: string; bundleText?: string; styleText?: string; meta?: boolean; policy?: string;
	bodyHtml?: string; scripts?: Array<{ text: string; type?: 'classic' | 'module' }>;
}): { html: string; scriptTexts: string[] };
