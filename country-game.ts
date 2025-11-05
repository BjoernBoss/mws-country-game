/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2025 Bjoern Boss Henrichsen */
import * as libCommon from "core/common.js";
import * as libClient from "core/client.js";
import * as libLocation from "core/location.js";

enum GamePhase {
	start = 'start',
	prepared = 'prepared',
	open = 'open',
	closed = 'closed',
	resolved = 'resolved'
};
enum ConnectionType {
	admin = 'admin',
	player = 'player',
	score = 'score'
};
interface PlayerState {
	score: number;
	choices: number[];
	client: libClient.ClientSocket | null;
};
class GameState {
	private phase: GamePhase;
	private correct: number[];
	private options: string[];
	private description: string;

	private players: Record<string, PlayerState>;
	private admin: libClient.ClientSocket | null;
	private scores: Set<libClient.ClientSocket>;
	private connected: Map<libClient.ClientSocket, string>;

	constructor() {
		this.phase = GamePhase.start;
		this.correct = [-1, -1, -1, -1];
		this.options = ['', '', '', ''];
		this.description = '';
		this.players = {};

		this.admin = null;
		this.scores = new Set<libClient.ClientSocket>();
		this.connected = new Map<libClient.ClientSocket, string>;
	}

	private allStatesChanged(): void {
		/* notify all active players */
		for (const key in this.players) {
			if (this.players[key].client != null)
				this.players[key].client.send(JSON.stringify({ code: 'dirty' }));
		}

		/* notify the active admin */
		if (this.admin != null)
			this.admin.send(JSON.stringify({ code: 'dirty' }));
	}
	private disconnectAll(): void {
		for (const key in this.players) {
			if (this.players[key].client != null) {
				this.players[key].client.send(JSON.stringify({ code: 'loggedOff' }));
				this.players[key].client.log('force-logged client off');
			}
		}
		this.players = {};
		this.connected.clear();
	}
	private scoreChanged(): void {
		for (const client of this.scores)
			client.send(JSON.stringify({ code: 'dirty' }));
	}

	public addPlayer(client: libClient.ClientSocket, name: string, reset: boolean, takeOwnership: boolean): { code: string } {
		const added: boolean = !(name in this.players);

		/* check if the current owner should be logged off */
		if (!added) {
			if (!takeOwnership)
				return { code: (this.players[name] != null ? 'inUse' : 'alreadyExists') };
			if (this.players[name].client != null) {
				this.players[name].client.send(JSON.stringify({ code: 'loggedOff' }));
				this.players[name].client.log('force-logged client off');
			}
		}

		/* check if the score should be reset */
		if (added || reset) {
			this.players[name] = { score: 0, choices: [-1, -1, -1, -1], client: null };
			this.scoreChanged();
		}

		/* configure the new active client and setup the playerstate */
		this.connected.set(client, name);
		this.players[name].client = client;
		client.log('logged client on');

		/* notify about the changed state */
		client.send(JSON.stringify({ code: 'dirty' }));
		return { code: 'ok' };
	}
	public addScore(client: libClient.ClientSocket): void {
		this.scores.add(client);
	}
	public addAdmin(client: libClient.ClientSocket): { code: string } {
		/* log the current admin off */
		if (this.admin != null) {
			this.admin.send(JSON.stringify({ code: 'loggedOff' }));
			this.admin.log('force-logged admin off');
		}

		/* setup the new admin */
		this.admin = client;
		this.admin.log(`logged admin on`);
		return { code: 'ok' };
	}
	public disconnect(client: libClient.ClientSocket, type: ConnectionType): void {
		if (type == ConnectionType.admin) {
			if (client == this.admin) {
				this.admin.log('logged admin off');
				this.admin = null;
			}
		}
		else if (type == ConnectionType.score)
			this.scores.delete(client);
		else {
			const name = this.connected.get(client);
			if (name != null) {
				if (this.players[name].client == client) {
					this.players[name].client.log('logged client off');
					this.players[name].client = null;
				}
				this.connected.delete(client);
			}
		}
	}

	/* called by players */
	public getPlayerState(client: libClient.ClientSocket): any {
		const name = this.connected.get(client);
		if (name == null || this.players[name].client != client)
			return { code: 'notLoggedIn' };

		/* return the player-state */
		return {
			code: 'ok',
			description: this.description,
			options: this.options,
			open: (this.phase == GamePhase.open),
			score: this.players[name].score,
			choices: this.players[name].choices,
			correct: this.correct
		};
	}
	public makeChoice(client: libClient.ClientSocket, index: number, value: number): { code: string } {
		const name = this.connected.get(client);
		if (name == null || this.players[name].client != client)
			return { code: 'notLoggedIn' };

		/* check if the choice can be made and is valid */
		if (this.phase != GamePhase.open)
			return { code: 'noChoicePossible' };
		if (index < 0 || index >= this.options.length || value < 0 || value >= 4)
			return { code: 'outOfRange' };
		if (value == this.players[name].choices[index])
			return { code: 'ok' };
		client.log(`made choice [${value}] for [${index}]`);

		/* update the choice of the player and notify him */
		this.players[name].choices[index] = value;
		client.send(JSON.stringify({ code: 'dirty' }))
		return { code: 'ok' };
	}

	/* called by score */
	public getScoreState(): any {
		let resp = {
			code: 'ok',
			scores: {}
		};
		for (const name in this.players)
			(resp.scores as any)[name] = this.players[name].score;
		return resp;
	}

	/* called by admin */
	public getAdminState(client: libClient.ClientSocket): any {
		if (this.admin != client)
			return { code: 'notLoggedIn' };
		return {
			code: 'ok',
			current: this.description,
			state: this.phase
		};
	}
	public resetAll(client: libClient.ClientSocket, resetPlayers: boolean) {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state has already been reached and otherwise set it up */
		if (this.phase == GamePhase.start)
			return { code: 'ok' };
		this.phase = GamePhase.start;
		client.log(resetPlayers ? 'reset game and players' : 'reset game');

		/* reset all players */
		if (resetPlayers)
			this.disconnectAll();
		else for (const name in this.players)
			this.players[name].choices = [-1, -1, -1, -1];
		this.correct = [-1, -1, -1, -1];

		/* reset the current round */
		this.description = '';
		this.options = ['', '', '', ''];

		/* notify the listener */
		this.allStatesChanged();
		this.scoreChanged();
		return { code: 'ok' };
	}
	public setupNext(client: libClient.ClientSocket, desc: string, opt: string[]): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.start && this.phase != GamePhase.resolved)
			return { code: 'seqError' };
		this.phase = GamePhase.prepared;
		client.log('setup next game');

		/* reset the choices */
		for (const name in this.players)
			this.players[name].choices = [-1, -1, -1, -1];
		this.correct = [-1, -1, -1, -1];

		/* setup the next game */
		this.description = desc;
		this.options = opt;

		/* notify the listener */
		this.allStatesChanged();
		return { code: 'ok' };
	}
	public startRound(client: libClient.ClientSocket): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.prepared)
			return { code: 'seqError' };
		this.phase = GamePhase.open;
		client.log('started next game');

		/* update the state and notify the listener */
		this.allStatesChanged();
		return { code: 'ok' };
	}
	public closeRound(client: libClient.ClientSocket): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.open)
			return { code: 'seqError' };
		this.phase = GamePhase.closed;
		client.log('closed game');

		/* update the state and notify the listener */
		this.allStatesChanged();
		return { code: 'ok' };
	}
	public resolveRound(client: libClient.ClientSocket, result: number[]): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.closed)
			return { code: 'seqError' };
		if (result.length != 4)
			return { code: 'malformed' };
		this.phase = GamePhase.resolved;
		client.log('resolved game');

		/* update the player scores */
		this.correct = result;
		for (const name in this.players) {
			for (let i = 0; i < 4; ++i) {
				if (this.players[name].choices[i] == this.correct[i])
					this.players[name].score += 1;
			}
		}

		/* notify the listener */
		this.allStatesChanged();
		this.scoreChanged();
		return { code: 'ok' };
	}
};

export class CountryGame implements libCommon.ModuleInterface {
	private fileStatic: (path: string) => string;
	private game: GameState;

	public name: string = 'country-game';
	constructor() {
		this.fileStatic = libLocation.MakeSelfPath(import.meta.url, '/static');
		this.game = new GameState();
	}
	private acceptWebSocket(client: libClient.ClientSocket, type: ConnectionType): void {
		/* configure the client (scores dont need to log in) */
		client.pushLog(type);
		client.log('websocket accepted');
		if (type == ConnectionType.score)
			this.game.addScore(client);

		/* register the callbacks */
		let that = this;
		client.ondata = function (data) {
			try {
				let parsed = JSON.parse(data.toString('utf-8'));

				/* handle the response based on the web-socket kind */
				let response;
				if (type == ConnectionType.admin)
					response = that.handleAdminMessage(client, parsed);
				else if (type == ConnectionType.player)
					response = that.handlePlayerMessage(client, parsed);
				else if (type == ConnectionType.score)
					response = that.handleScoreMessage(parsed);
				else
					throw new Error(`Unknown kind [${type}] encountered`);

				/* write the result out */
				if (typeof (parsed.cmd) == 'string')
					client.log(`handling command [${parsed.cmd}]: ${response.code}`);
				else
					client.log(`response: ${response.code}`);
				client.send(JSON.stringify(response));
			} catch (err) {
				client.error(`exception while handling ${type}: [${err}]`);
				client.close();
			}
		};
		client.onclose = function () {
			that.game.disconnect(client, type);
			client.log(`websocket closed`);
		};
	}
	private handlePlayerMessage(client: libClient.ClientSocket, msg: any): { code: string } {
		if (typeof (msg.cmd) != 'string' || msg.cmd == '')
			return { code: 'malformed' };

		/* handle the command */
		switch (msg.cmd) {
			case 'login':
				if (typeof (msg.name) != 'string' || msg.name == '')
					return { code: 'malformed' };
				return this.game.addPlayer(client, msg.name, msg.resetState === true, msg.takeOwnership === true);
			case 'state':
				return this.game.getPlayerState(client);
			case 'choice':
				if (typeof (msg.index) != 'number' || typeof (msg.value) != 'number')
					return { code: 'malformed' };
				return this.game.makeChoice(client, msg.index, msg.value);
			default:
				return { code: 'malformed' };
		}
	}
	private handleAdminMessage(client: libClient.ClientSocket, msg: any): { code: string } {
		if (typeof (msg.cmd) != 'string' || msg.cmd == '')
			return { code: 'malformed' };

		/* handle the command */
		switch (msg.cmd) {
			case 'login':
				return this.game.addAdmin(client);
			case 'state':
				return this.game.getAdminState(client);
			case 'reset':
				return this.game.resetAll(client, msg.total === true);
			case 'next':
				if (typeof (msg.description) != 'string' || msg.description.length == 0 || typeof (msg.options) != 'object' || msg.options.length != 4)
					return { code: 'malformed' };
				for (let i = 0; i < 4; ++i) {
					if (typeof (msg.options[i]) != 'string' || msg.options[i].length == 0)
						return { code: 'malformed' };
				}
				return this.game.setupNext(client, msg.description, msg.options);
			case 'start':
				return this.game.startRound(client);
			case 'close':
				return this.game.closeRound(client);
			case 'resolve':
				if (typeof (msg.values) != 'object')
					return { code: 'malformed' };
				return this.game.resolveRound(client, msg.values);
			default:
				return { code: 'malformed' };
		}
	}
	private handleScoreMessage(msg: any): { code: string } {
		if (typeof (msg.cmd) != 'string' || msg.cmd == '')
			return { code: 'malformed' };

		/* handle the command */
		switch (msg.cmd) {
			case 'state':
				return this.game.getScoreState();
			default:
				return { code: 'malformed' };
		}
	}

	public request(client: libClient.HttpRequest): void {
		client.log(`Game handler for [${client.path}]`);
		if (client.ensureMethod(['GET']) == null)
			return;

		/* check if its a root-request and forward it accordingly */
		if (client.path == '/') {
			client.tryRespondFile(this.fileStatic('client/main.html'));
			return;
		}
		if (client.path == '/score') {
			client.tryRespondFile(this.fileStatic('score/main.html'));
			return;
		}

		/* respond to the request by trying to server the file */
		client.tryRespondFile(this.fileStatic(client.path));
	}
	public upgrade(client: libClient.HttpUpgrade): void {
		client.log(`Game handler for [${client.path}]`);

		/* check if its a web-socket request */
		if (client.path == '/ws-client') {
			if (client.tryAcceptWebSocket((ws) => this.acceptWebSocket(ws, ConnectionType.player)))
				return;
			client.log(`Invalid request for client web-socket point`);
		}
		else if (client.path == '/ws-admin') {
			if (client.tryAcceptWebSocket((ws) => this.acceptWebSocket(ws, ConnectionType.admin)))
				return;
			client.log(`Invalid request for admin web-socket point`);
		}
		else if (client.path == '/ws-score') {
			if (client.tryAcceptWebSocket((ws) => this.acceptWebSocket(ws, ConnectionType.score)))
				return;
			client.log(`Invalid request for score web-socket point`);
		}
		client.respondNotFound();
		return;
	}
};
