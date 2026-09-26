import { createGameClient, getGameIdentity } from '../config/supabase.js';
import { StorageService } from '../storage/StorageService.js';
import { validateGLBFile } from '../assets/GLBLoader.js';

const elements = {
  name: document.getElementById('active-name'), file: document.getElementById('active-file'), size: document.getElementById('active-size'), date: document.getElementById('active-date'),
  form: document.getElementById('map-form'), mapName: document.getElementById('map-name'), mapFile: document.getElementById('map-file'), upload: document.getElementById('upload'),
  deactivate: document.getElementById('deactivate'), status: document.getElementById('manager-status'), progress: document.getElementById('upload-progress'),
};
let storage = null, active = null, busy = false;
function status(text, loading = false) { elements.status.textContent = text; elements.progress.hidden = !loading; }
function setBusy(value) { busy = value; elements.upload.disabled = value || !storage; elements.deactivate.disabled = value || !active; elements.mapFile.disabled = value; elements.mapName.disabled = value; }
function showMap(map) {
  active = map;
  elements.name.textContent = map?.name || 'Pianura di test';
  elements.file.textContent = map?.file_name || '—';
  elements.size.textContent = map ? `${(map.file_size / 1024 / 1024).toFixed(1)} MB` : '—';
  elements.date.textContent = map?.created_at ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(map.created_at)) : '—';
  elements.upload.textContent = map ? 'SOSTITUISCI MAPPA' : 'CARICA NUOVA MAPPA GLB';
  setBusy(busy);
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
    status('Seleziona un GLB di massimo 50 MB. La pianura resta disponibile come fallback.');
  } catch (error) { console.warn('[Free Roam] Pannello manager:', error); status(error.message || String(error)); }
}
elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!storage || busy) return;
  setBusy(true);
  try {
    const file = await validateGLBFile(elements.mapFile.files?.[0], 'map');
    const map = await storage.uploadMap(file, elements.mapName.value, (stage) => status(stage, true));
    showMap(map); elements.form.reset(); status('Mappa caricata e attivata. Sarà visibile al prossimo ingresso nel Free Roam.');
  } catch (error) { console.warn('[Free Roam] Upload mappa:', error); status(`Upload non riuscito: ${error.message || error}`); }
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
