export interface HostResponse { status: number; body: any }
export type HostRequest = (method: string, path: string, body?: unknown) => Promise<HostResponse>;
export interface Fixture {
	root: string;
	layer: string;
	git: (args: string[], cwd?: string) => string;
	dt: (...args: string[]) => { status: number | null; stdout: string; stderr: string };
	head: () => string;
	cleanup: () => void;
}
export interface Case { id: string; route: string; method: string; path: string | ((ctx: any) => string); body?: unknown; before?: (ctx: any) => unknown; expect: (res: HostResponse, ctx: any, snap?: any) => unknown }
export declare const cases: Case[];
export declare function runContract(opts: { request: HostRequest; fixture: Fixture; only?: string[] }): Promise<{ passed: string[]; failed: Array<{ id: string; why: string }> }>;
export declare function makeFixture(opts: { engineDir: string; tmp?: string }): Fixture;
