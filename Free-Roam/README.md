# FantaScuola Free Roam

## Parkour automatico

Durante un salto o una caduta il controller cerca pareti vicine e verifica con
raycast il piano sopra il bordo. Un bordo reale ha sempre priorità sulla
scalata della parete; su una parete continua senza bordo il giocatore si
aggancia e sale tenendo avanti. I raycast usano l'indice collisioni della
mappa e partono solo quando il personaggio è in aria o sta scalando.

Da un bordo: avanti o Salto sale sul tetto se c'è spazio; sinistra/destra
segue il bordo; Salto più laterale tenta un salto corto; indietro più Salto
si stacca dalla parete. Durante la scalata fallback, avanti sale, laterale
attraversa, Salto più avanti cerca un appiglio più alto e Salto più laterale
prova una presa adiacente. I controlli sono gli stessi su PC e telefono.

Le mesh con `userData.noClimb = true`, `userData.climbable = false` oppure
`userData.parkour = false` sono escluse. Per visualizzare raggi, normali,
traiettoria, candidati, target e score aggiungere `?parkourDebug=1` all'URL
di Free Roam. Senza il parametro non vengono creati oggetti di debug.

## Mappe mobile a zone

Il desktop usa il GLB originale. Il telefono usa un manifest e GLB per zona,
generati automaticamente dallo stesso file sorgente. Il preprocessore applica
scala e rotazione della mappa, taglia i triangoli sui confini delle zone e
riduce le **texture originali** (non le sostituisce con colori inventati).
Ogni zona contiene i triangoli reali anche per le collisioni. Il client carica
la zona di spawn, poi le otto vicine in ordine di distanza; ne mantiene al
massimo una corona 3×3 intorno al giocatore. Una zona non ancora pronta blocca
temporaneamente l'attraversamento del confine. Le risorse Three.js sono
rilasciate all'uscita dalla zona.

Da `Free-Roam/`:

```sh
npm install
npm run build:mobile-map -- /percorso/Quartiere.glb --source-url https://huggingface.co/buckets/UTENTE/BUCKET/resolve/Quartiere.glb --tile-size 16 --output mobile-maps/Quartiere.mobile
```

L'output va in `Free-Roam/mobile-maps/Quartiere.mobile/` e viene servito da
GitHub Pages insieme al progetto. Il GLB originale resta nel Bucket Hugging
Face. Attivare la mappa dal pannello manager incollando il solo URL
`/resolve/Quartiere.glb`: il pannello verifica il manifest mobile e la zona
di spawn prima di attivare la mappa. Le mappe già attive senza URL mobile nei
metadata usano lo stesso percorso derivato dal nome GLB. La migrazione
`supabase/migrations/202609270001_free_roam_mobile_map.sql` rende leggibile
la mappa Hugging Face anche agli ospiti.

Per mappe con scala o rotazione personalizzate passare gli stessi valori
`--scale` e `--rotation` al preprocessore; il manifest rifiuta valori diversi
da quelli attivi in Supabase. `--tile-size` (default 32 metri),
`--texture-size` (default 512 pixel per lato), `--geometry-ratio` (default 0.18)
e `--geometry-error` (default 0.2 metri) permettono di regolare il peso. La
geometria viene semplificata con meshoptimizer mantenendo UV e normali.
Il preprocessore interrompe la generazione se una zona supera 16 MB, così
una mappa troppo densa non viene pubblicata accidentalmente per iPhone.
Usare un `--tile-size` più piccolo in quel caso. Per file grandi può servire
`NODE_OPTIONS=--max-old-space-size=8192` sul computer di preprocessing.

Il formato supportato è GLB 2.0 con geometria triangolare e un buffer interno,
texture baseColor PNG/JPEG/WebP incorporate o locali, accessors interleaved,
COLOR_0 e KHR_texture_transform. Eventuali estensioni geometriche compresse
(per esempio Draco o Meshopt) producono un errore esplicito: esportare prima
un GLB non compresso. La generazione è ripetibile dopo ogni aggiornamento;
gli URL dei tile includono un hash del contenuto per evitare cache obsolete.

Test: `npm test`. Il test del preprocessore con una mappa GLB sintetica è
disponibile in `tests/fixtures/create-sample-map.mjs`.

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
