// The headers every response carries, and the app page's exact Content-Security-Policy (README § security).
export function baseHeaders(res) {
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.removeHeader('X-Powered-By');
}

export function appCsp(nonce, filesOrigin, filesKey) {
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

/** A record file on the files origin: script off, a unique origin. */
export const FILE_CSP = 'sandbox';
