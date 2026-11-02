/**
 * Typed API client. Every request routes through the ONE adapter (`./adapter.ts`) — since M3 a
 * thin path/shape translator over the clean engine contract (the row projection itself lives
 * server-side at GET /api/presentation; the adapter was INVERTED rather than deleted — see its
 * header).
 */
import { adapterRequest } from './adapter';

export class ApiError extends Error {
	status: number;
	code: string | undefined;

	constructor(message: string, status: number, code?: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
	}
}

export interface ApiResponse<T> {
	data: T;
	raw: Record<string, unknown>;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
	// Transitional (M3 deletes): the adapter answers every old-wire request from the clean API.
	const result = await adapterRequest(method, path, body);
	return { data: result.data as T, raw: result.raw };
}

export const api = {
	get<T>(path: string): Promise<ApiResponse<T>> {
		return request<T>('GET', path);
	},
	post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		return request<T>('POST', path, body);
	},
	patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
		return request<T>('PATCH', path, body);
	},
	delete<T>(path: string): Promise<ApiResponse<T>> {
		return request<T>('DELETE', path);
	},
};

/** Query parameters accepted by `GET /items/:path` (and similar list endpoints). */
export interface QueryParams {
	limit?: number;
	page?: number;
	sort?: string;
	search?: string;
	fields?: string;
	meta?: string;
	filter?: Record<string, unknown>;
	[key: string]: unknown;
}

/**
 * Flattens `filter` recursively into `filter[a][b]=v` pairs; other keys pass through as scalars.
 * Arrays (needed for `_and`/`_or` groups of clause objects, and `_in`/`_nin` value lists) flatten
 * into index-bracketed segments (`filter[_and][0][field][_eq]=v`) rather than being stringified —
 * Express's default 'extended' (qs) query parser reconstructs those back into real arrays
 * server-side (verified against `server/src/rest/query.ts`'s `parseQuery`), and `_in`/`_nin`
 * already accept either a real array or a comma-joined string (`server/src/query/compare.ts`), so
 * indexed entries round-trip correctly for both group clauses and value lists.
 */
export function buildQuery(query: QueryParams): string {
	const pairs: string[] = [];

	function flatten(prefix: string, value: unknown): void {
		if (Array.isArray(value)) {
			value.forEach((item, index) => flatten(`${prefix}[${index}]`, item));
		} else if (value !== null && value !== undefined && typeof value === 'object') {
			for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
				flatten(`${prefix}[${key}]`, nested);
			}
		} else if (value !== undefined) {
			pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
		}
	}

	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) continue;
		if (key === 'filter') {
			flatten('filter', value);
		} else {
			pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
		}
	}

	return pairs.length ? `?${pairs.join('&')}` : '';
}
