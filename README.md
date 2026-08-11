# nba-auction-draft

Multiplayer NBA auction draft web app. Up to 4 players join a room, take turns nominating and bidding on NBA players with a fixed coin budget, and fill out a 5-slot roster (PG/SG/SF/PF/C).

## Stack
- **Frontend**: React (Vite) — `client/`
- **Backend**: Node/Express + Socket.IO — `server/`

## Status
Scaffolding stage: room creation/joining and live player presence (up to 4 players) are wired up. Bidding, drafting, and results logic are not built yet.

## Getting started

Install dependencies for both apps:

```bash
npm run install:all
```

Copy the env examples:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Run both frontend and backend together:

```bash
npm run dev
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173

## Project structure

```
server/   Express + Socket.IO backend, in-memory room store
client/   React (Vite) frontend
```
