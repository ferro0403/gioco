# Mini Arena PvP 2D

PvP 2D multiplayer "easy" con server authoritative Node.js + WebSocket e client HTML5 Canvas mobile-first. Pronto per deploy su hosting free-tier (Render/Fly/Railway) e giocabile da Android/iPhone via browser.

## Struttura cartelle
- `package.json`
- `server.js`
- `public/`
  - `index.html`
  - `client.js`
  - `style.css`
  - `assets/char0.png`, `char1.png`, `char2.png`, `char3.png`

> Questa PR include solo file di testo: nessuna modifica o aggiunta ai PNG in `public/assets/`.

## Requisiti
- Node.js 18+.
- Nessun database o file system persistente.
- Unica dipendenza: `ws`.

## Avvio locale
```bash
npm install
npm start
# Apri http://localhost:3000 su due tab / dispositivi
```

## Deploy rapido (Render)
1. Crea un nuovo servizio Web su Render collegando il repo GitHub.
2. **Build command**: `npm install`
3. **Start command**: `npm start`
4. Porta automatica: il server legge `process.env.PORT` (fallback 3000).

Il progetto è compatibile anche con Fly.io/Railway con gli stessi comandi di build/start.

## Aggiungere o sostituire sprite
Metti le nuove PNG in `public/assets/` con i nomi `char0.png`, `char1.png`, `char2.png`, `char3.png` (48x48 consigliato). Se un file manca o non si carica, il client mostra un rettangolo colorato per quel personaggio.

> Nota: questa versione non modifica né include PNG aggiuntivi; puoi mantenere o sostituire i file già presenti in `public/assets/` secondo le tue esigenze.

## Gameplay
- Lobby automatica 2–8 giocatori.
- Movimento con confini mappa 800x600.
- HP 100; colpi hitscan 4/s, danno 25; morte a 0 HP e respawn dopo 2.5s.
- Scoreboard live con kills/deaths, ping stimato e numero giocatori.
- Personaggi selezionabili (ID 0–3) con sprite dedicato.

### Controlli
- **Mobile**: joystick virtuale in basso a sinistra; mira e fuoco continuo tenendo premuto a destra.
- **Desktop**: WASD per muoversi, mouse per mirare e click per sparare.
- Il canvas è full-screen responsive con `preventDefault` sugli eventi touch per evitare scroll/pinch.

## Come testare con due telefoni
1. Avvia il server (locale con port forwarding/tunnel oppure deploy su Render/Fly/Railway).
2. Condividi il link `http(s)://<host>:<port>` con entrambi i telefoni.
3. Ogni giocatore sceglie nickname e personaggio, poi preme **Entra**. Entrambi vedono i movimenti e gli hit real-time.

Se su iPhone non parte: prova Safari/Chrome, fai refresh della pagina e attendi qualche secondo (alcuni free-tier risvegliano l'istanza al primo accesso).
