# \[MWS\] Module to Play a small Country Guessing Game Together
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

An interactive country guessing game module for [`@bjoernboss/mws`](https://github.com/BjoernBoss/mws).

Players match trivia values (area, population, currency, etc.) to the countries Germany, Denmark, Hungary, and Cambodia. Played in German.

Uses WebSockets for real-time communication between players, an administrator controlling game progress, and scoreboards. All active sessions are managed by the `CountryGame` object.

Note: The `dk-flag-feature.svg` and `kh-flag-feature.svg` assets originate from Wikipedia.

## Installation
Install directly from GitHub:

    $ npm install github:BjoernBoss/mws-country-game

Requires Node.js 22 or later.

## Setup

Register the module in your server setup:

```typescript
import * as mws from "@bjoernboss/mws";
import { CountryGame } from "@bjoernboss/mws-country-game";

const server = new mws.Server();
const handler = mws.dispatch({
    '/country-game': new CountryGame(),
});
server.listen(handler, { port: 8080 });
```

## Endpoints

All paths listed are relative to the mount point (e.g. `/country-game`).

| Method | Path | Description |
|---|---|---|
| GET | `/` | Player page |
| GET | `/score` | Scoreboard |
| GET | `/admin` | Admin control panel |
| GET | `/static/**` | Static assets (CSS, JS, SVG) |
| WebSocket | `/ws-client` | Player session |
| WebSocket | `/ws-score` | Scoreboard session |
| WebSocket | `/ws-admin` | Admin session |

## Game Rules

- One administrator controls game progress
- Player names are unique and identify a player across reconnects
- Multiple scoreboards can be open simultaneously
- The administrator selects questions and advances through rounds
