export default {
	key: 'apply-for-a-grant',
	steps: [
		{ story: 'open-the-portal' },
		{ action: { name: 'submit', args: {} } },
		{ action: { name: 'approve', args: (s) => ({ id: s.world.apps.at(-1).id }) } },
		{ action: { name: 'approve', args: { id: 'A-1' } }, expectRefusal: true },
	],
};
