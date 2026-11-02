export function stripJsonc(text: string): string;
export function readModuleGrant(root: string): Record<string, { reads: string[]; writes: string[] }>;
export function readModuleGrantResult(root: string): { grant: Record<string, { reads: string[]; writes: string[] }>; problem: string | null };
