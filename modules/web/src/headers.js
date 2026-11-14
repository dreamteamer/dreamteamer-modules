// The headers every response carries, and the policies (README § security; cr-modules-017 §1 with the 03:45
// revision's form-action 'none' and the plan's reading 6: record files frame inline under /_files/).
export function baseHeaders(res) {
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.removeHeader('X-Powered-By');
}

/** The app page's policy on the one listener, `host` the Host the request arrived on: scripts are this page's nonce
 *  plus the app path only, so nothing under /_files/ or /_frames/ can run as app code. */
export function appCsp(nonce, host) {
	return [
		"default-src 'none'",
		`script-src 'nonce-${nonce}' http://${host}/app/`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
		`frame-src http://${host}/_frames/ http://${host}/_files/`,
		"form-action 'none'",
		"base-uri 'none'",
		"object-src 'none'",
		"frame-ancestors 'none'",
	].join('; ');
}

/** The two-origin policy dt web 0.2 served; server.js uses it until the one listener replaces it (task 7). */
export function twoOriginCsp(nonce, filesOrigin, filesKey) {
	return [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}'`,
		"style-src 'self' 'unsafe-inline'",
		`img-src 'self' ${filesOrigin} data: blob:`,
		"font-src 'self' data:",
		"connect-src 'self'",
		filesKey ? `frame-src ${filesOrigin}/${filesKey}/_dt/frame/ ${filesOrigin}/${filesKey}/w/` : `frame-src ${filesOrigin}`,
		"frame-ancestors 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join('; ');
}

/** A record file under /_files/: script off, a unique origin. */
export const FILE_CSP = 'sandbox';
/** A module frame document under /_frames/: scripts, never the page's origin. */
export const FRAME_CSP_PREFIX = 'sandbox allow-scripts';
