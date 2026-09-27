import { Game } from './core/Game.js?v=gameplay-v1';
import { createGameClient, getGameIdentity } from './config/supabase.js';
import { StorageService } from './storage/StorageService.js';
import { cleanDisplayName } from './utils/text.js';
import { AvatarCreator } from './avatars/AvatarCreator.js';
import { DEFAULT_PIXEL_AVATAR, normalizePixelAvatarConfig } from './avatars/AvatarConfig.js';
import { setupMobileExperience } from './ui/MobileExperience.js';
import { LoadingScreen } from './ui/LoadingScreen.js';

const enter = document.getElementById('enter');
const nameInput = document.getElementById('player-name');
const openCreator = document.getElementById('open-avatar-creator');
const status = document.getElementById('menu-status');
const progress = document.getElementById('menu-progress');
const errorBox = document.getElementById('startup-error');
const welcome = document.getElementById('welcome');
const loadingScreen = new LoadingScreen(document.getElementById('world-loading'));

const mobileExperience = setupMobileExperience();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js?v=gameplay-v1').catch((error) => {
    console.warn('[Free Roam] Service Worker non disponibile:', error);
  });
}

let client = null;
let identity = null;
let storage = null;
let game = null;
let pixelConfig = normalizePixelAvatarConfig(DEFAULT_PIXEL_AVATAR);

function message(text, busy = false, error = false) {
  status.textContent = text;
  progress.hidden = !busy;
  errorBox.hidden = !error;
  if (error) errorBox.textContent = text;
}

function configKey() {
  return `free-roam-avatar-config:${identity?.userId || 'guest'}`;
}

function loadLocalPixelConfig() {
  try {
    return normalizePixelAvatarConfig(
      JSON.parse(localStorage.getItem(configKey()) || 'null') || DEFAULT_PIXEL_AVATAR,
    );
  } catch {
    return normalizePixelAvatarConfig(DEFAULT_PIXEL_AVATAR);
  }
}

function saveLocalPixelConfig(config) {
  localStorage.setItem(configKey(), JSON.stringify(normalizePixelAvatarConfig(config)));
}

let avatarCreator = null;
const saveAvatar = async (config) => {
    pixelConfig = normalizePixelAvatarConfig(config);
    saveLocalPixelConfig(pixelConfig);

    if (storage && identity) {
      try {
        await storage.saveAvatarConfig(pixelConfig);
        identity.avatarConfig = pixelConfig;
        message('Avatar salvato nel tuo account FantaScuola.');
      } catch (error) {
        console.warn('[Free Roam] Salvataggio avatar account non riuscito:', error);
        message(
          'Avatar salvato su questo dispositivo. Sincronizzazione account non disponibile.',
          false,
          true,
        );
      }
    } else {
      message('Avatar salvato su questo dispositivo.');
    }
};

function showAvatarCreator() {
  if (!avatarCreator) avatarCreator = new AvatarCreator(document.getElementById('avatar-creator'), saveAvatar);
  avatarCreator.open(pixelConfig);
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

      const savedName = localStorage.getItem(`free-roam-name:${identity.userId}`);
      nameInput.value = cleanDisplayName(savedName || identity.displayName);

      pixelConfig = normalizePixelAvatarConfig(identity.avatarConfig || loadLocalPixelConfig());

      try {
        const cloudConfig = await storage.loadAvatarConfig();
        if (cloudConfig) pixelConfig = normalizePixelAvatarConfig(cloudConfig);
      } catch (error) {
        console.warn('[Free Roam] Config avatar account non disponibile:', error);
      }

      saveLocalPixelConfig(pixelConfig);
      message('Account collegato · avatar e multiplayer disponibili.');
    } else {
      nameInput.value = cleanDisplayName(
        localStorage.getItem('free-roam-name:guest') || 'Giocatore',
      );
      pixelConfig = loadLocalPixelConfig();
      message(
        client
          ? 'Multiplayer dedicato disponibile come ospite. Avatar salvato sul dispositivo.'
          : 'Multiplayer dedicato disponibile come ospite. Account e dati Supabase non disponibili.',
      );
    }
  } catch (error) {
    console.warn('[Free Roam] Account non disponibile:', error);
    nameInput.value = 'Giocatore';
    pixelConfig = loadLocalPixelConfig();
    message(
      client
        ? 'Account non disponibile · puoi comunque entrare nel multiplayer dedicato come ospite.'
        : 'Supabase non disponibile · il multiplayer dedicato resta utilizzabile come ospite.',
    );
  } finally {
    enter.disabled = false;
  }
}

openCreator.addEventListener('click', showAvatarCreator);

enter.addEventListener('click', async () => {
  if (game) return;

  const displayName = cleanDisplayName(nameInput.value);
  if (!displayName) {
    message('Inserisci un nome giocatore.', false, true);
    nameInput.focus();
    return;
  }

  const selection = {
    type: 'pixel',
    config: pixelConfig,
  };

  localStorage.setItem(
    `free-roam-name:${identity?.userId || 'guest'}`,
    displayName,
  );

  enter.disabled = true;
  message('Ingresso nel mondo…', true);
  loadingScreen.show();
  welcome.hidden = true;
  avatarCreator?.dispose();
  avatarCreator = null;

  try {
    game = new Game(
      document.getElementById('game'),
      document.getElementById('hud'),
      {
        client,
        identity,
        displayName,
        avatarSelection: selection,
        storage,
      },
    );

    await game.start((stage, progressValue) => {
      message(stage, true);
      loadingScreen.update(stage, progressValue);
    });

    await loadingScreen.complete();

    window.addEventListener(
      'pagehide',
      () => {
        game?.dispose();
        avatarCreator?.dispose();
        mobileExperience.dispose();
      },
      { once: true },
    );
  } catch (error) {
    console.error('[Free Roam] Avvio fallito:', error);
    message(
      `Avvio fallito: ${error?.message || error || 'errore sconosciuto'}`,
      false,
      true,
    );

    loadingScreen.hideImmediately();
    welcome.hidden = false;
    await game?.dispose().catch(() => {});
    game = null;
    enter.disabled = false;
  }
});

setupAccount();
