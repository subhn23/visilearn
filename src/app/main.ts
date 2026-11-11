import './styles.css';
import Alpine from 'alpinejs';
import { loadModules } from './myModules.ts';
import { panels } from './panels.ts';
import { registerStores } from './stores.ts';
import { registerCatalog } from './views/catalog.ts';
import { registerImporter } from './views/importer.ts';
import { registerPlayer } from './views/player.ts';
import { registerSettings } from './views/settings.ts';

// load saved modules before the first render so module lessons can open directly by URL
await loadModules();

registerStores(Alpine);
registerImporter(Alpine);
registerCatalog(Alpine);
registerPlayer(Alpine);
registerSettings(Alpine);
for (const p of Object.values(panels)) p.register(Alpine);

(window as any).Alpine = Alpine;
Alpine.start();
