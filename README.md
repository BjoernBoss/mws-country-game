# \[MWS\] Module to Play a Funny Country Guessing Game Together
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue?style=flat-square)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-brightgreen?style=flat-square)](LICENSE.txt)

This repository is designed to be used with the [`MWS-Base`](https://github.com/BjoernBoss/mws-base.git).

The game provided here was designed as an internal joke game. It consists of various questions, which need to map values to the countries 'Germany', 'Denmark', 'Hungary', and 'Cambodia'.
It provides an interactive way to play this game together with a large player base, and one administrator, who controls the game progress.
It allows this by making use of `WebSockets`.

All active sessions are managed by the created `CountryGame` object. Sharing this object across multiple listened ports will therefore ensure each port shares a common player base.

### Endpoints:

- The players can just connect via the root `/` or `/client/main.html`.
- Scoreboards can be connected via `/score` or `/score/main.html`.
- The admin page can be connected via `/admin/main.html`.

## Using the Module
To use this module, setup the `mws-base`. Then simply clone this repository into the modules directory:

	$ git clone https://github.com/BjoernBoss/mws-country-game.git modules/country-game

Afterwards, transpile the entire server application, and construct this module in the `setup.js Run` method as:

```JavaScript
const m = await import("./country-game/country-game.js");
server.listenHttp(93, new m.CountryGame(), null);
```
