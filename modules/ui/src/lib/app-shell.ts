/** The host draws the app's own shell — its nav, the sheet, tabs, search, toasts (dt web: `__DT_HOST__.nav === 'app'`).
 *  Inside VS Code the editor is the shell, and none of that is drawn. Read once: a host declares it before the bundle runs. */
export const appShell: boolean = typeof window !== 'undefined' && (window as any).__DT_HOST__?.nav === 'app';
