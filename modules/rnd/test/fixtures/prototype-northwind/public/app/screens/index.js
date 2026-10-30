// The screen registry: node-importable (render touches the DOM only when called).
import { el } from '../ui.js';

const home = { key: 'home', portal: null, route: '/', kind: 'static', title: 'Northwind grants', render: () => el('section', {}, [el('h1', {}, ['Northwind grants']), el('a', { href: '#/gp/home' }, ['Grantee portal']), ' ', el('a', { href: '#/bo/home' }, ['Back office'])]) };
const gpHome = {
	key: 'gp-home', portal: 'gp', route: '/gp/home', kind: 'app', title: 'Your grants', prd: [], open: [], stories: ['open-the-portal'],
	render: (ctx) => el('section', {}, [el('h1', {}, ['Your grants']), el('div', { 'data-demo': 'open-the-portal' }, [`${ctx.store.world.apps.length} application(s)`, ' ', el('a', { href: '#/gp/apply' }, ['Apply'])])]),
};
const gpApply = {
	key: 'gp-apply', portal: 'gp', route: '/gp/apply', kind: 'app', title: 'Apply', prd: ['GRT-R-001', 'GRT-R-002'], open: [], stories: ['submit-an-application'],
	render: (ctx) => el('section', {}, [el('h1', {}, ['Apply for a grant', ctx.meta.markRules(['GRT-R-001', 'GRT-R-002'])]), el('div', { class: 'spacer' }), el('form', { 'data-demo': 'submit-an-application' }, [el('label', {}, ['Amount ', el('input', { value: '1200' })]), el('button', { type: 'button' }, ['Submit'])])]),
};
const boReview = {
	key: 'bo-review', portal: 'bo', route: '/bo/review', kind: 'app', title: 'Review', prd: ['GRT-R-010'], open: [], stories: ['review-the-application'],
	render: (ctx) => el('section', {}, [el('h1', {}, ['Applications to review']), el('ul', { 'data-demo': 'review-the-application approve-step' }, ctx.store.world.apps.map((a) => el('li', {}, [`${a.id} · ${a.status}`])))]),
};
const boHome = { key: 'bo-home', portal: 'bo', route: '/bo/home', kind: 'app', title: 'Back office', stub: true, prd: [], open: [], stories: [] };

export const screens = [home, gpHome, gpApply, boReview, boHome];
export const byKey = Object.fromEntries(screens.map((s) => [s.key, s]));
