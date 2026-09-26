# FantaScuola Free Roam v0.2

Modulo 3D isolato in `/Free-Roam/`. Il sito principale aggiunge il collegamento al gioco e un riquadro nel pannello gestione. Il gioco non modifica voti o punti.

## Avvio e deploy

Servire la radice del repository via HTTP, per esempio con `python3 -m http.server 8765`, e aprire `http://localhost:8765/Free-Roam/`. Su GitHub Pages l'indirizzo è `https://gattomorto24.github.io/fantascuola/Free-Roam/`. Moduli ES, Three.js 0.180.0 e supabase-js 2.58.0 sono inclusi in `vendor/`; gli import e gli asset usano percorsi relativi, validi anche sotto il prefisso `/fantascuola/`.

Il menu precompila il nome dall'account FantaScuola quando disponibile. Anche senza sessione si entra nel multiplayer pubblico come ospite; senza Realtime si può comunque muoversi in locale. Ogni ingresso usa un punto di spawn leggermente diverso per rendere visibili i giocatori vicini. Su computer: WASD/frecce, Shift, Spazio e trascinamento del mouse. Su mobile: joystick sinistro per muoversi, riquadro destro per la camera, pulsante Corsa a interruttore e pulsante Salta.

## Attivazione Supabase

Applicare `supabase/migrations/202609260002_free_roam.sql` e poi `supabase/migrations/202609260003_free_roam_github_assets.sql` al progetto Supabase `peiztoqldcnughvjksfa`. La prima migrazione crea tabelle, bucket e permessi; la seconda consente gli URL GitHub Pages e porta i limiti dei metadati a 50 MB per avatar e 500 MB per mappe. I nuovi GLB non sono caricati in Supabase Storage; le righe già presenti continuano a funzionare. Gli ospiti possono leggere mappe e avatar pubblici da GitHub e quindi vedere lo stesso mondo dei giocatori con account. L'accesso manager è verificato dal database usando `account_profiles.is_premium`, come nell'app principale.

La mappa attiva è letta da `free_roam_settings.active_map_id`. Il manager incolla il link a un GLB della Release **free-roam-assets** nel riquadro **Free Roam**, poi può attivarlo o disattivarlo. Il file viene servito da GitHub Pages; in Postgres restano URL e metadati. Una mappa assente o non caricabile usa la pianura di test. La mappa GLB è visuale: la fisica usa ancora il piano di base, mentre `collision_model` è predisposto per una versione successiva.

Un avatar GLB locale resta sul dispositivo e gli altri vedono il placeholder. Con **Pubblica da GitHub Releases**, l'account registra l'URL del file già pubblicato; gli altri client ricevono il riferimento `published:<uuid>` e caricano il GLB da GitHub Pages. Sono ammessi GLB fino a 50 MB per gli avatar e 500 MB per le mappe. La selezione locale verifica estensione, dimensione e header; un errore di caricamento ripristina il placeholder.

## Pubblicazione dei GLB su GitHub

1. Nel repository `gattomorto24/fantascuola`, crea una Release con tag esatto `free-roam-assets` e allega i file `.glb` con nomi semplici (lettere, numeri, punti, `_` o `-`). Aggiungi gli asset alla stessa Release quando ne servono altri.
2. Imposta GitHub Pages con origine **GitHub Actions**. La workflow `.github/workflows/free-roam-pages.yml` pubblica il sito e copia i GLB della Release in `Free-Roam/release-assets/`. Dopo aver aggiunto un asset a una Release già pubblicata, avvia manualmente la workflow se non è partita da sola.
3. Attendi la fine del deploy, poi incolla nel gioco o nel pannello manager il link originale della Release, per esempio `https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/scuola.glb`. Il pannello controlla che la copia su GitHub Pages esista e che rispetti il limite prima di salvare i metadati.

GitHub Pages ammette un sito pubblicato fino a circa 1 GB: una mappa da 500 MB consuma circa metà dello spazio disponibile. Mantieni nella Release solo gli asset che devono restare raggiungibili. I GLB nuovi non dipendono dal limite globale dei file di Supabase Storage.

## Architettura

- `core`, `input`, `player`, `camera`: loop a delta, movimento, salto, camera, player locale e remoti.
- `avatars`, `assets`: placeholder, avatar pixel e caricamento GLB indipendente dal controller.
- `world`: pianura, manifest e MapLoader GLB; spawn configurabile.
- `multiplayer`: Presence per i giocatori, Broadcast per posizione e rotazione a 10 Hz, interpolazione dei remoti e rimozione alla disconnessione. Le coordinate non sono persistite in Postgres.
- `storage`, `admin`: URL firmati, upload e attivazione mappa, pannello manager.
- `config`, `ui`: parametri centralizzati, percorsi e HUD con FPS, stato rete, giocatori, posizione, mappa e avatar.

## Verifiche

`cd Free-Roam && npm test` esegue i test di multiplayer, input touch, spawn e validazione dei link GitHub. Per il controllo finale aprire due schede o sessioni, anche come ospiti: verificare che entrambe mostrino `Online`, `Giocatori: 2` e l'avatar dell'altro, quindi provare movimento e uscita. Su telefono verificare joystick, visuale, Corsa e Salta. Ripetere con due account autenticati per gli avatar e le mappe pubblicati. Provare anche un GLB valido, un GLB danneggiato, attivazione e disattivazione mappa da account manager e il rifiuto degli stessi comandi da account normale.
