# FantaScuola Free Roam v0.2

Modulo 3D isolato in `/Free-Roam/`. Il sito principale aggiunge il collegamento al gioco e un riquadro nel pannello gestione. Il gioco non modifica voti o punti.

## Avvio e deploy

Servire la radice del repository via HTTP, per esempio con `python3 -m http.server 8765`, e aprire `http://localhost:8765/Free-Roam/`. Su GitHub Pages l'indirizzo è `https://gattomorto24.github.io/fantascuola/Free-Roam/`. Moduli ES, Three.js 0.180.0 e supabase-js 2.58.0 sono inclusi in `vendor/`; gli import e gli asset usano percorsi relativi, validi anche sotto il prefisso `/fantascuola/`.

Il menu precompila il nome dall'account FantaScuola quando disponibile. Senza sessione o senza Realtime si può entrare e muoversi in locale. WASD/frecce muovono il personaggio, Shift corre, Spazio salta, mouse trascina la camera e rotella cambia la distanza.

## Attivazione Supabase

Applicare `supabase/migrations/202609260002_free_roam.sql` al progetto Supabase `peiztoqldcnughvjksfa` prima di usare gli upload. La migrazione crea le tabelle `free_roam_avatars`, `free_roam_maps`, `free_roam_settings`, i bucket privati `free-roam-avatars` e `free-roam-maps`, le policy RLS/Storage e le funzioni `free_roam_is_manager` e `free_roam_activate_map`. L'accesso manager è verificato dal database usando `account_profiles.is_premium`, come nell'app principale. La chiave nel client è pubblicabile; nessuna service role key è richiesta nel browser.

La mappa attiva è letta da `free_roam_settings.active_map_id`. Il manager può caricare e attivare un GLB dal riquadro **Free Roam** nel pannello gestione oppure disattivarlo. Il file è salvato in Storage e in Postgres restano solo metadati. Le mappe e gli avatar pubblicati richiedono una sessione autenticata per ottenere un URL firmato. Una mappa assente o non caricabile usa la pianura di test. La mappa GLB è visuale: la fisica usa ancora il piano di base, mentre `collision_model` è predisposto per una versione successiva.

Un avatar GLB locale resta sul dispositivo e gli altri vedono il placeholder. Con **Pubblica avatar**, il file viene caricato nel bucket personale e gli altri client ricevono solo il riferimento `published:<uuid>`, mai il blob. Sono ammessi GLB fino a 15 MB per gli avatar e 50 MB per le mappe. Il caricatore verifica estensione, dimensione e header, e un errore ripristina il placeholder.

## Architettura

- `core`, `input`, `player`, `camera`: loop a delta, movimento, salto, camera, player locale e remoti.
- `avatars`, `assets`: placeholder, avatar pixel e caricamento GLB indipendente dal controller.
- `world`: pianura, manifest e MapLoader GLB; spawn configurabile.
- `multiplayer`: Presence per i giocatori, Broadcast per posizione e rotazione a 10 Hz, interpolazione dei remoti e rimozione alla disconnessione. Le coordinate non sono persistite in Postgres.
- `storage`, `admin`: URL firmati, upload e attivazione mappa, pannello manager.
- `config`, `ui`: parametri centralizzati, percorsi e HUD con FPS, stato rete, giocatori, posizione, mappa e avatar.

## Verifiche

`cd Free-Roam && npm test` esegue il test del protocollo Presence/Broadcast e della rimozione dei player con due client simulati. Per il controllo finale servono due sessioni autenticate distinte: entrare come due utenti, verificare nome/avatar, movimento e rotazione fluidi in entrambe le direzioni, quindi chiudere una sessione e verificare che scompaia nell'altra. Provare anche un GLB valido, un GLB danneggiato, upload e disattivazione mappa da account manager e il rifiuto degli stessi comandi da account normale. Controllare il percorso GitHub Pages dopo il deploy.
