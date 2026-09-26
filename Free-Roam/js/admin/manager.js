import { createGameClient, getGameIdentity } from '../config/supabase.js';
import { StorageService } from '../storage/StorageService.js';

const elements = {
  name: document.getElementById('active-name'), file: document.getElementById('active-file'), size: document.getElementById('active-size'), date: document.getElementById('active-date'),
  form: document.getElementById('map-form'), mapName: document.getElementById('map-name'), mapUrl: document.getElementById('map-url'), upload: document.getElementById('upload'),
  deactivate: document.getElementById('deactivate'), status: document.getElementById('manager-status'), progress: document.getElementById('upload-progress'),
};
let storage = null, active = null, busy = false;
let lastRefresh = 0;
function status(text, loading = false) { elements.status.textContent = text; elements.progress.hidden = !loading; }
function setBusy(value) { busy = value; elements.upload.disabled = value || !storage; elements.deactivate.disabled = value || !active; elements.mapUrl.disabled = value; elements.mapName.disabled = value; }
function showMap(map) {
  active = map;
  elements.name.textContent = map?.name || 'Pianura di test';
  elements.file.textContent = map?.file_name || '—';
  elements.size.textContent = map ? `${(map.file_size / 1024 / 1024).toFixed(1)} MB` : '—';
  elements.date.textContent = map?.created_at ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(map.created_at)) : '—';
  elements.upload.textContent = map ? 'SOSTITUISCI MAPPA DA GITHUB' : 'ATTIVA MAPPA DA GITHUB';
  setBusy(busy);
}
async function refreshMap() {
  if (!storage || busy) return;
  lastRefresh = Date.now();
  try { showMap(await storage.activeMap()); }
  catch (error) { console.warn('[Free Roam] Aggiornamento mappa:', error); }
}
async function initialize() {
  try {
    const client = createGameClient();
    const identity = await getGameIdentity(client);
    if (!identity) throw new Error('Accedi a FantaScuola con un account manager.');
    const { data: manager, error } = await client.rpc('free_roam_is_manager');
    if (error) throw error;
    if (manager !== true) throw new Error('Questa sezione è riservata ai manager.');
    storage = new StorageService(client, identity.userId);
    showMap(await storage.activeMap());
    lastRefresh = Date.now();
    client.channel('free-roam-map-manager')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'free_roam_settings' }, refreshMap)
      .subscribe();
    status('Incolla il link di un GLB pubblicato su GitHub Pages dalla Release free-roam-assets (massimo 500 MB).');
  } catch (error) { console.warn('[Free Roam] Pannello manager:', error); status(error.message || String(error)); }
}

window.addEventListener('focus', () => {
  if (Date.now() - lastRefresh > 10000) refreshMap();
});
elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!storage || busy) return;
  setBusy(true);
  try {
    const map = await storage.uploadMap(elements.mapUrl.value, elements.mapName.value, (stage) => status(stage, true));
    showMap(map); elements.form.reset(); status('Mappa caricata e attivata. Sarà visibile al prossimo ingresso nel Free Roam.');
  } catch (error) { console.warn('[Free Roam] Attivazione mappa:', error); status(`Attivazione non riuscita: ${error.message || error}`); }
  finally { setBusy(false); }
});
elements.deactivate.addEventListener('click', async () => {
  if (!storage || busy) return;
  setBusy(true); status('Disattivazione mappa…', true);
  try { await storage.activateMap(null); showMap(null); status('Mappa personalizzata disattivata. La pianura di test è attiva.'); }
  catch (error) { status(`Disattivazione non riuscita: ${error.message || error}`); }
  finally { setBusy(false); }
});
initialize();
