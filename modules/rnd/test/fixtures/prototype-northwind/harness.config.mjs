// The synthetic Northwind prototype the harness's own tests play: two portals, four screens (one a stub), a
// store with three mutations and one refusal, a session with no snapshot, and a string world snapshot.
export default {
	products: { 'rnd/products/grantee-portal': { key: 'gp', label: 'Grantee portal' }, 'rnd/products/back-office': { key: 'bo', label: 'Back office' } },
	app: '__northwind',
	registry: 'public/app/screens/index.js',
	store: 'public/app/state.js',
	defaultUser: { gp: 'U-applicant', bo: 'U-officer' },
	forbidden: 'harness.forbidden.txt',
	prototype: 'rnd/prototypes/2026-01-12--northwind-portal',
};
