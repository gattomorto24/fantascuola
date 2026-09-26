# FantaScuola Free Roam

Modulo 3D isolato in `/Free-Roam/`. Il sito principale aggiunge il collegamento al gioco e un riquadro nel pannello gestione. Il gioco non modifica voti o punti.

## Realtime dedicato

Il movimento multiplayer non usa più Supabase Realtime. Il client si collega al server WebSocket dedicato:

`wss://fantascuola-realtime-production.up.railway.app/room/main`

Supabase resta disponibile per account, profili, mappe, avatar e dati persistenti. Posizioni, rotazioni e stato di movimento sono temporanei e non vengono scritti in Postgres.

Protocollo principale:

- `join`: registra il giocatore e riceve lo snapshot iniziale della stanza;
- `state`: aggiorna posizione, rotazione, animazione e avatar a 10 Hz;
- `leave`: rimuove immediatamente il giocatore disconnesso;
- `ping/pong`: misura la latenza applicativa;
- heartbeat WebSocket server-side: elimina connessioni morte;
- reconnect client con backoff esponenziale.

Il server limita i messaggi a 8 KB, applica rate limiting per client e accetta fino a 128 connessioni nella stanza di test. Il sorgente di riferimento è in `server/realtime.mjs`; la produzione è attualmente una Railway Function.

## Avvio e deploy del client

Servire la radice del repository via HTTP, per esempio con `python3 -m http.server 8765`, e aprire `http://localhost:8765/Free-Roam/`. Su GitHub Pages l'indirizzo è `https://gattomorto24.github.io/fantascuola/Free-Roam/`.

Moduli ES, Three.js e supabase-js sono inclusi in `vendor/`; gli import e gli asset usano percorsi relativi, validi anche sotto il prefisso `/fantascuola/`.

## Stress test grafico

Aggiungere `?stress=100` all'URL del Free Roam per generare 100 RemotePlayer locali che si muovono attorno allo spawn:

`/Free-Roam/?stress=100`

Questo test misura soprattutto il costo di rendering/interpolazione sul dispositivo e non crea 100 connessioni di rete reali. L'HUD continua a mostrare gli FPS.

## Stress test WebSocket

Da `Free-Roam/`:

`npm install`

`npm run loadtest -- 100 2 10`

I parametri sono rispettivamente numero client, aggiornamenti al secondo per client e durata in secondi. Il default è volutamente prudente: 100 client a 2 Hz per 10 secondi. Per una classe reale il client normale usa 10 Hz, ma un test 100×10 Hz genera un fan-out molto maggiore e va eseguito solo quando serve.

## Asset e Supabase

Le mappe e gli avatar GLB continuano a usare l'attuale sistema di asset/persistenza. Un avatar GLB locale resta sul dispositivo; gli avatar pubblicati sono referenziati tramite ID. Le coordinate realtime non sono persistite.

## Architettura

- `core`, `input`, `player`, `camera`: loop, movimento, salto, camera e giocatori;
- `avatars`, `assets`: avatar e caricamento GLB;
- `world`: pianura, manifest e MapLoader;
- `multiplayer/WebSocketTransport.js`: trasporto WebSocket;
- `multiplayer/MultiplayerManager.js`: protocollo, reconnect, snapshot, interpolazione e ping;
- `server/realtime.mjs`: sorgente del server dedicato;
- `debug/StressHarness.js`: bot grafici locali per misurare FPS;
- `storage`, `admin`: dati persistenti e pannello manager;
- `config`, `ui`: parametri centralizzati e HUD.

## Verifiche consigliate

Aprire due dispositivi/account diversi e verificare che entrambi mostrino `Online`, vedano il nome e il movimento dell'altro e che l'uscita rimuova il RemotePlayer. Poi chiudere brutalmente una scheda e verificare la rimozione tramite heartbeat. Infine provare `?stress=100` separatamente su PC, Mac e iPhone per confrontare gli FPS.
