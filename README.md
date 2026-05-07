# \[MWS\] Module to Play a Funny Country Guessing Game Together
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

This repository is designed to be used with the [`MWS-Base`](https://github.com/BjoernBoss/mws-base.git).

The game provided here was designed as a joke game. It consists of various questions, which need to map values to the countries 'Germany', 'Denmark', 'Hungary', and 'Cambodia', and is played in german.
It provides an interactive way to play this game together with a large player base, and one administrator, who controls the game progress.
It allows this by making use of `WebSockets`.

All active sessions are managed by the created `CountryGame` object. Sharing this object across multiple listened ports will therefore ensure each port shares a common player base.

Note: The `dk-flag-feature.svg` and `kh-flag-feature.svg` assets originate from `Wikipedia`.

## Setup
Clone into the modules directory of an existing MWS-Base installation:

    $ git clone https://github.com/BjoernBoss/mws-country-game.git modules/country-game

Register the module in `modules/setup.js`:

```JavaScript
import * as libInterface from "core/interface.js";

export async function Run(server) {
    try {
        const countryGame = await import("country-game/country-game.js");
        const dispatch = new libInterface.DispatchModule({
            '/country-game': new countryGame.CountryGame(),
        });
        server.listenHttp(8080, dispatch, (host) => host == 'localhost');
    } catch (e) {
        throw new Error(`Failed to load module: ${e.message}`);
    }
}
```

Then just build and run the server as usual.

### Endpoints:
| Method | Path | Description |
|---|---|---|
| GET | `/` | Primary access for normal players |
| GET | `/score` | Endpoint for scoreboards |
| GET | `/admin` | Endpoint for admin |
| GET | `/**/*.css`, `/**/*.js`, `/**/*.svg` | Static assets |
| WebSocket | `/ws-{admin\|client\|score}` | Join a game session and be notified about its state |

## Game Rules
- There can only be one administrator
- Player names are unique and identify one player
- There can be multiple scoreboards
- The administrator advances the game progress and selects the next questions