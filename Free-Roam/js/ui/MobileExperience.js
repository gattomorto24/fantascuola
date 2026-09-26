export function detectEnvironment() {
  const nav = globalThis.navigator || {};
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
  const touch = Number(nav.maxTouchPoints || 0) > 0 || 'ontouchstart' in globalThis;
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
  const shortViewport = Math.min(globalThis.innerWidth || 9999, globalThis.innerHeight || 9999) <= 1024;
  const mobile = touch && (coarse || shortViewport);
  return standalone && mobile ? 'mobile-standalone' : mobile ? 'mobile-browser' : 'desktop';
}

function platformName() {
  const nav = globalThis.navigator || {};
  const ua = String(nav.userAgent || '');
  const isiPadDesktop = nav.platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || isiPadDesktop) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'mobile';
}

export function setupMobileExperience() {
  const environment = detectEnvironment();
  document.body.dataset.environment = environment;

  const installScreen = document.getElementById('install-screen');
  const continueButton = document.getElementById('install-continue');
  const nativeInstallButton = document.getElementById('install-native');
  const instructions = document.getElementById('install-instructions');
  const rotateScreen = document.getElementById('rotate-screen');
  const platform = platformName();
  let installPrompt = null;

  const renderInstructions = () => {
    if (!instructions) return;
    if (platform === 'ios') {
      instructions.innerHTML = '<li>Tocca <strong>Condividi</strong> in Safari.</li><li>Seleziona <strong>Aggiungi alla schermata Home</strong>.</li><li>Apri FantaScuola dalla nuova icona.</li>';
    } else if (platform === 'android') {
      instructions.innerHTML = '<li>Apri il menu del browser.</li><li>Scegli <strong>Aggiungi a schermata Home</strong> oppure <strong>Installa app</strong>.</li><li>Apri FantaScuola dalla nuova icona.</li>';
    } else {
      instructions.innerHTML = '<li>Apri il menu del browser.</li><li>Cerca <strong>Aggiungi alla schermata Home</strong> o <strong>Installa app</strong>.</li><li>Apri FantaScuola dalla nuova icona.</li>';
    }
  };

  if (installScreen && environment === 'mobile-browser') {
    renderInstructions();
    installScreen.hidden = false;
  }

  continueButton?.addEventListener('click', () => {
    installScreen.hidden = true;
    updateOrientation();
  });

  globalThis.addEventListener?.('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (environment === 'mobile-browser' && nativeInstallButton) nativeInstallButton.hidden = false;
  });

  nativeInstallButton?.addEventListener('click', async () => {
    if (!installPrompt) return;
    nativeInstallButton.disabled = true;
    try { await installPrompt.prompt(); }
    finally {
      installPrompt = null;
      nativeInstallButton.hidden = true;
      nativeInstallButton.disabled = false;
    }
  });

  function updateOrientation() {
    if (!rotateScreen || environment === 'desktop') return;
    const portrait = (globalThis.innerHeight || 0) > (globalThis.innerWidth || 0);
    const installVisible = installScreen && !installScreen.hidden;
    rotateScreen.hidden = !portrait || installVisible;
  }

  globalThis.addEventListener?.('resize', updateOrientation);
  globalThis.addEventListener?.('orientationchange', updateOrientation);
  updateOrientation();

  return {
    environment,
    isMobile: environment !== 'desktop',
    dispose() {
      globalThis.removeEventListener?.('resize', updateOrientation);
      globalThis.removeEventListener?.('orientationchange', updateOrientation);
    },
  };
}
