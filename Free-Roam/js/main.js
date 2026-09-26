import { Game } from './core/Game.js';
import { createGameClient, getGameIdentity } from './config/supabase.js';
import { StorageService } from './storage/StorageService.js';
import { cleanDisplayName } from './utils/text.js';
import { validateGLBFile } from './assets/GLBLoader.js';

const enter = document.getElementById('enter');
const nameInput = document.getElementById('player-name');
const avatarChoice = document.getElementById('avatar-choice');
const avatarFile = document.getElementById('avatar-file');
const avatarFileField = document.getElementById('avatar-file-field');
const avatarGithubField = document.getElementById('avatar-github-field');
const avatarGithubUrl = document.getElementById('avatar-github-url');
const avatarGithubName = document.getElementById('avatar-github-name');
const publish = document.getElementById('publish-avatar');
const status = document.getElementById('menu-status');
const progress = document.getElementById('menu-progress');
const errorBox = document.getElementById('startup-error');
let client = null, identity = null, storage = null, game = null;

function message(text, busy = false, error = false) {
  status.textContent = text; progress.hidden = !busy; errorBox.hidden = !error;
  if (error) errorBox.textContent = text;
}
function addPublishedOption(avatar) {
  const option = new Option(`Pubblicato · ${avatar.name}`, `published:${avatar.id}`);
  avatarChoice.add(option);
  return option;
}

async function setupAccount() {
  try {
    client = createGameClient();
    storage = client ? new StorageService(client, null) : null;
    identity = await Promise.race([
      getGameIdentity(client),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (identity) {
      storage = new StorageService(client, identity.userId);
      const saved = localStorage.getItem(`free-roam-name:${identity.userId}`);
      nameInput.value = cleanDisplayName(saved || identity.displayName);
      message('Account collegato · multiplayer disponibile.');
      try { (await storage.listMyAvatars()).forEach(addPublishedOption); }
      catch (error) { console.warn('[Free Roam] Catalogo avatar non disponibile:', error); }
    } else {
      nameInput.value = cleanDisplayName(localStorage.getItem('free-roam-name:guest') || 'Giocatore');
      message(client
        ? 'Multiplayer come ospite disponibile. Mappe e avatar GitHub pubblici sono visibili.'
        : 'Modalità locale. Connessione multiplayer non disponibile.');
    }
  } catch (error) {
    console.warn('[Free Roam] Account non disponibile:', error);
    nameInput.value = 'Giocatore'; message(client
      ? 'Account non disponibile · puoi comunque entrare nel multiplayer come ospite.'
      : 'Account non disponibile · modalità locale.');
  } finally { enter.disabled = false; }
}

avatarChoice.addEventListener('change', () => {
  const local = avatarChoice.value === 'local';
  const github = avatarChoice.value === 'github';
  avatarFileField.hidden = !local;
  avatarGithubField.hidden = !github;
  publish.hidden = !github || !identity;
});
avatarFile.addEventListener('change', async () => {
  if (!avatarFile.files?.length) return;
  try { await validateGLBFile(avatarFile.files[0], 'avatar'); message(`GLB locale pronto: ${avatarFile.files[0].name}. Gli altri vedranno il placeholder.`); }
  catch (error) { avatarFile.value = ''; message(error.message, false, true); }
});
publish.addEventListener('click', async () => {
  if (!storage) return;
  if (!avatarGithubUrl.value.trim()) { message('Incolla il link GLB della Release GitHub.', false, true); avatarGithubUrl.focus(); return; }
  publish.disabled = true; enter.disabled = true;
  try {
    const avatar = await storage.publishAvatar(avatarGithubUrl.value, avatarGithubName.value, (stage) => message(stage, true));
    addPublishedOption(avatar).selected = true;
    avatarGithubField.hidden = true; publish.hidden = true;
    message('Avatar collegato a GitHub. Ora anche gli altri giocatori potranno vederlo.');
  } catch (error) { console.warn('[Free Roam] Pubblicazione avatar:', error); message(`Pubblicazione non riuscita: ${error.message || error}`, false, true); }
  finally { publish.disabled = false; enter.disabled = false; progress.hidden = true; }
});
enter.addEventListener('click', async () => {
  if (game) return;
  const displayName = cleanDisplayName(nameInput.value);
  if (!displayName) { message('Inserisci un nome giocatore.', false, true); nameInput.focus(); return; }
  let selection = avatarChoice.value;
  if (selection === 'github') { message(identity ? 'Pubblica prima l’avatar da GitHub.' : 'Accedi a FantaScuola per pubblicare un avatar.', false, true); return; }
  if (selection === 'local') {
    try { selection = { type: 'local', file: await validateGLBFile(avatarFile.files?.[0], 'avatar') }; }
    catch (error) { message(error.message, false, true); return; }
  }
  localStorage.setItem(`free-roam-name:${identity?.userId || 'guest'}`, displayName);
  enter.disabled = true; message('Ingresso nel mondo…', true);
  try {
    game = new Game(document.getElementById('game'), document.getElementById('hud'), { client, identity, displayName, avatarSelection: selection, storage });
    await game.start((stage) => message(stage, true));
    document.getElementById('welcome').hidden = true;
    window.addEventListener('pagehide', () => game?.dispose(), { once: true });
  } catch (error) {
    console.error('[Free Roam] Avvio fallito:', error);
    message('Impossibile avviare il gioco. Verifica WebGL e riprova.', false, true);
    await game?.dispose().catch(() => {}); game = null; enter.disabled = false;
  }
});
setupAccount();
