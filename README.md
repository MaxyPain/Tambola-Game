# Tambola Pro Ready

A local-network and online-ready Tambola / Housie multiplayer app.

## Features
- **Real-time Multiplayer:** Play with friends and family over local Wi-Fi or across the internet.
- **Host & Player Roles:** The host controls the room settings, generates the room, and seamlessly joins as a player.
- **Persistent Sessions:** Players receive a persistent `playerId` saved in their browser storage. If a device goes to sleep or the browser is refreshed, they are safely reconnected to their exact ticket.
- **Smart Draws:** Game progression is smooth. Numbers are drawn automatically when a timer expires, or instantly if all connected players hit the "Vote to Draw" button.
- **Player Limitations:** Configurable caps on the room's maximum player count to keep games manageable.

## How It Was Built
The application is built using a modern JavaScript stack designed for real-time interactivity:
- **Frontend:** Built with **React** to provide a reactive, component-driven user interface for digital tickets and the number board.
- **Backend:** A **Node.js** and **Express** server handles static file serving, API routing, and state management in memory.
- **Real-time Communication:** Powered by **WebSockets** (using Engine.io/Socket.io). This ensures instant synchronization of called numbers, player votes, and room state across all connected devices without the need for manual polling.

## Challenges Faced
Building a real-time multiplayer game comes with unique hurdles. Here are the main challenges tackled during development:

1. **The Tambola Ticket Algorithm:** Generating valid Housie tickets is notoriously complex. The grid is 3x9, and each row must have exactly 5 numbers. Furthermore, columns are restricted to specific ranges (e.g., column 1 is 1-9, column 2 is 10-19). Crafting an algorithm that randomizes these numbers while strictly adhering to the classic rules was a significant logical puzzle.
2. **State Synchronization & Network Latency:** Keeping the game state perfectly synced across mobile devices and laptops on different network speeds was tricky. We had to ensure that the "next number" timer is perfectly aligned and that late-joining or reconnecting players receive the current game state immediately without desynchronizing.
3. **Handling Disconnections (Persistence):** On mobile browsers, screens frequently go to sleep, causing WebSockets to drop. Relying purely on WebSocket connection IDs meant players would lose their tickets on reconnect. This was solved by generating a unique `playerId` stored securely in the browser's `localStorage`. When a socket reconnects, it authenticates with this ID to re-bind to the original ticket session.
4. **Concurrency in Voting:** Implementing the "Vote to Draw" feature required handling race conditions. If multiple players vote at the exact same millisecond, the backend has to securely register the votes, check them against the connected player count, and ensure only one number is drawn to prevent double-skips.
5. **Local Network Accessibility:** Making the app easily playable over local Wi-Fi without requiring cloud deployment meant configuring the Node server to bind to `0.0.0.0` and creating clear instructions for the host to share their local LAN IP.

## Run locally

```bash
npm install
npm start
```

Open:

- `http://localhost:3000` on the host machine
- `http://YOUR_LAN_IP:3000` on other phones on the same Wi-Fi

## Render deployment

Use the included `render.yaml`.

Build command:
```bash
npm install && npm run build
```

Start command:
```bash
npm start
```

## Notes

- The host creates the room and also joins as a player automatically.
- Each player gets a persistent `playerId` in browser storage, so refresh returns them to the same ticket.
- Players are limited by the room player count.
- Draws happen when all connected players vote, or automatically after the timer expires.
