import './styles.css';
import { renderCatalog } from './catalog.ts';
import { h } from './dom.ts';
import { mountPlayer } from './player.ts';
import { byId } from './scenes.ts';

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function route() {
  cleanup?.();
  cleanup = null;
  const m = /^#\/s\/(.+)$/.exec(location.hash);
  if (m) {
    const entry = byId(decodeURIComponent(m[1]));
    if (entry?.scene) {
      document.title = `${entry.scene.title} · visilearn`;
      cleanup = mountPlayer(root, entry.scene);
      window.scrollTo(0, 0);
      return;
    }
    root.replaceChildren(h('div.catalog', null, h('h1', null, 'Topic not found'), h('a', { href: '#/' }, '← Back to all topics')));
    return;
  }
  document.title = 'visilearn';
  renderCatalog(root, route);
}

window.addEventListener('hashchange', route);
route();
