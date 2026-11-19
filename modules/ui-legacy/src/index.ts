// The library: what a host bundles. The stylesheet (dist/lib/style.css) carries the icons, the tokens and
// the base; a host adds its own theme mapping after it (the VS Code extension's vscode.css).
import '@vscode/codicons/dist/codicon.css';
export { mount, type MountOptions } from './mount';
import './styles/tokens.css';
import './styles/base.css';
export { HostError, type Transport } from './transport/types';
export { httpTransport } from './transport/http';
