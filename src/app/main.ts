import './styles.css';
import Alpine from 'alpinejs';
import { panels } from './panels.ts';
import { registerStores } from './stores.ts';
import { registerCatalog } from './views/catalog.ts';
import { registerPlayer } from './views/player.ts';

registerStores(Alpine);
registerCatalog(Alpine);
registerPlayer(Alpine);
for (const p of Object.values(panels)) p.register(Alpine);

(window as any).Alpine = Alpine;
Alpine.start();
