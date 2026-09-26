# FantaScuola Free Roam v0.3

Modulo 3D isolato in `/Free-Roam/`. Il sito principale resta indipendente dal gioco.

## Novità v0.3

### Mobile / PWA

- rilevamento `desktop`, `mobile-browser` e `mobile-standalone` usando touch capability, pointer type, viewport e display-mode;
- schermata **PIÙ SPAZIO PER GIOCARE** sui browser mobile con istruzioni iOS/Android e possibilità di continuare nel browser;
- manifest PWA e service worker scoped a `/Free-Roam/`;
- layout standalone con `viewport-fit=cover`, safe-area e canvas a tutto schermo;
- overlay **RUOTA IL TELEFONO** in portrait senza ricaricare la sessione.

### Controlli touch

Il vecchio riquadro VISUALE e il pulsante CORRI sono stati rimossi.

- joystick analogico sinistro;
- dead zone e intensità analogica;
- sprint integrato nel ring esterno del joystick;
- feedback visivo quando lo sprint è attivo;
- camera tramite drag in qualsiasi zona libera del canvas;
- Pointer Events separati per joystick, camera e salto;
- multitouch reale: movimento + sprint + camera + salto contemporanei;
- un solo grande pulsante Salto;
- blocco delle gesture browser durante il gameplay, senza applicarlo ai menu.

I parametri del joystick sono centralizzati in `js/config/settings.js`.

### Pixel Avatar Creator

Il nuovo avatar consigliato è un personaggio voxel/pixel 3D umanoide costruito proceduralmente. Include:

- testa, collo, torso e bacino;
- braccia, avambracci e mani separati;
- cosce, gambe e piedi separati;
- occhi neri;
- geometria capelli visibile con ciocche/frangia;
- 4 tonalità pelle;
- 4 colori capelli;
- 3 colori maglietta;
- 3 colori pantaloni indipendenti;
- scarpe nere o bianche;
- animazioni procedurali leggere Idle / Walk / Run / Jump.

Il creator mostra una preview 3D ruotabile. Non genera né salva GLB: salva esclusivamente una piccola configurazione JSON. Per gli utenti autenticati la configurazione viene salvata nei metadata Supabase Auth dell'account; per gli ospiti resta anche in `localStorage`.

La configurazione viene inclusa nello snapshot multiplayer quando `avatarId === "pixel"`, così ogni client ricostruisce localmente lo stesso avatar. Il supporto a placeholder, GLB locale e GLB pubblicati resta disponibile.

### Disconnessioni

La migrazione al server WebSocket dedicato era già stata effettuata nella release precedente e v0.3 non cambia provider o architettura di trasporto.

Quando la connessione cade:

1. parte un breve grace period configurabile;
2. il client tenta il reconnect automatico;
3. se la connessione torna rapidamente non appare alcun overlay;
4. se la perdita è reale compare una schermata fullscreen **DISCONNESSO**;
5. **RICONNETTI** forza una sessione pulita senza ricaricare la pagina;
6. **CONTINUA OFFLINE** chiude il realtime, rimuove i RemotePlayer e lascia movimento, camera, avatar e mappa attivi localmente.

Durante l'overlay i controlli vengono disabilitati e i touch non attraversano la schermata.

## Realtime

Endpoint:

`wss://fantascuola-realtime-production.up.railway.app/room/main`

Supabase resta responsabile di account e dati persistenti. Le coordinate realtime non vengono salvate nel database.

## Stress test

Per generare giocatori remoti locali e misurare gli FPS:

`/Free-Roam/?stress=100`

Per il test WebSocket headless:

`npm install`

`npm run loadtest -- 100 2 10`

## Verifiche manuali consigliate

Desktop:

- WASD;
- Shift;
- Space;
- camera mouse;
- avatar pixel e GLB.

Mobile landscape:

- joystick analogico;
- ring sprint;
- camera su area libera;
- joystick + camera insieme;
- joystick + camera + salto;
- safe-area;
- nessun pull-to-refresh/scroll durante gameplay;
- PWA/standalone.

Avatar:

- tutte le combinazioni pelle/capelli/maglia/pantaloni/scarpe;
- salvataggio e riapertura;
- avatar remoto identico;
- animazioni Walk/Run.

Network:

- micro-disconnessione recuperata senza overlay;
- disconnessione reale → fullscreen;
- RICONNETTI;
- CONTINUA OFFLINE.

## Deploy

GitHub Pages usa percorsi relativi sotto `/fantascuola/Free-Roam/`. Non usare force push.
