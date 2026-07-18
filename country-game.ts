/* SPDX-License-Identifier: BSD-3-Clause */
/* Copyright (c) 2024-2026 Bjoern Boss Henrichsen */
import * as mws from "@bjoernboss/mws";

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
	client: mws.ClientSocket | null;
};
class GameState {
	private phase: GamePhase;
	private correct: number[];
	private options: string[];
	private description: string;

	private players: Record<string, PlayerState>;
	private admin: mws.ClientSocket | null;
	private scores: Set<mws.ClientSocket>;
	private connected: Map<mws.ClientSocket, string>;

	constructor() {
		this.phase = GamePhase.start;
		this.correct = [-1, -1, -1, -1];
		this.options = ['', '', '', ''];
		this.description = '';
		this.players = {};

		this.admin = null;
		this.scores = new Set<mws.ClientSocket>();
		this.connected = new Map<mws.ClientSocket, string>;
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

	public addPlayer(client: mws.ClientSocket, name: string, reset: boolean, takeOwnership: boolean): { code: string } {
		const added: boolean = !(name in this.players);

		/* check if the player is already logged in */
		if (this.connected.has(client))
			return { code: 'alreadyLoggedIn' };

		/* check if the current owner should be logged off */
		if (!added) {
			if (!takeOwnership)
				return { code: (this.players[name].client != null ? 'inUse' : 'alreadyExists') };
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
	public addScore(client: mws.ClientSocket): void {
		this.scores.add(client);
	}
	public addAdmin(client: mws.ClientSocket): { code: string } {
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
	public disconnect(client: mws.ClientSocket, type: ConnectionType): void {
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
	public getPlayerState(client: mws.ClientSocket): any {
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
	public makeChoice(client: mws.ClientSocket, index: number, value: number): { code: string } {
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
		client.trace(`made choice [${value}] for [${index}]`);

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
	public getAdminState(client: mws.ClientSocket): any {
		if (this.admin != client)
			return { code: 'notLoggedIn' };
		return {
			code: 'ok',
			current: this.description,
			state: this.phase
		};
	}
	public resetAll(client: mws.ClientSocket, resetPlayers: boolean) {
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
	public setupNext(client: mws.ClientSocket, desc: string, opt: string[]): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.start && this.phase != GamePhase.resolved)
			return { code: 'seqError' };
		this.phase = GamePhase.prepared;
		client.trace('setup next game');

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
	public startRound(client: mws.ClientSocket): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.prepared)
			return { code: 'seqError' };
		this.phase = GamePhase.open;
		client.trace('started next game');

		/* update the state and notify the listener */
		this.allStatesChanged();
		return { code: 'ok' };
	}
	public closeRound(client: mws.ClientSocket): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.open)
			return { code: 'seqError' };
		this.phase = GamePhase.closed;
		client.trace('closed game');

		/* update the state and notify the listener */
		this.allStatesChanged();
		return { code: 'ok' };
	}
	public resolveRound(client: mws.ClientSocket, result: number[]): { code: string } {
		if (this.admin != client)
			return { code: 'notLoggedIn' };

		/* check if the state-sequence is valid and update it */
		if (this.phase != GamePhase.closed)
			return { code: 'seqError' };
		if (result.length != 4)
			return { code: 'malformed' };
		this.phase = GamePhase.resolved;
		client.trace('resolved game');

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

export class CountryGame extends mws.ModuleHandler {
	private fileStatic: (path: string) => string;
	private fileAssets: (path: string) => string;
	private game: GameState;
	private connected: Set<mws.ClientSocket>;

	constructor() {
		super('country-game');

		this.fileStatic = mws.createPathSelf(import.meta.url, '../static');
		this.fileAssets = mws.createPathSelf(import.meta.url, '../assets');
		this.game = new GameState();
		this.connected = new Set<mws.ClientSocket>();
	}
	private async acceptWebSocket(client: mws.ClientSocket, type: ConnectionType): Promise<void> {
		this.connected.add(client);

		/* configure the client (scores dont need to log in) */
		client.tagLog(type);
		client.log('websocket accepted');
		if (type == ConnectionType.score)
			this.game.addScore(client);

		/* register the callbacks */
		client.on('data', (data) => {
			try {
				let parsed = JSON.parse(data.toString('utf-8'));

				/* handle the response based on the web-socket kind */
				let response;
				if (type == ConnectionType.admin)
					response = this.handleAdminMessage(client, parsed);
				else if (type == ConnectionType.player)
					response = this.handlePlayerMessage(client, parsed);
				else if (type == ConnectionType.score)
					response = this.handleScoreMessage(parsed);
				else
					throw new Error(`Unknown kind [${type}] encountered`);

				/* write the result out */
				if (typeof (parsed.cmd) == 'string')
					client.trace(`handling command [${parsed.cmd}]: ${response.code}`);
				else
					client.trace(`response: ${response.code}`);
				client.send(JSON.stringify(response));
			} catch (err: any) {
				client.error(`exception while handling ${type}: [${err.message}]`);
				client.close();
			}
		});
		client.on('close', () => {
			this.game.disconnect(client, type);
			this.connected.delete(client);
			client.log(`websocket closed`);
		});
	}
	private handlePlayerMessage(client: mws.ClientSocket, msg: any): { code: string } {
		if (typeof (msg.cmd) != 'string' || msg.cmd == '')
			return { code: 'malformed' };

		/* handle the command */
		let loggedIn = false
		switch (msg.cmd) {
			case 'login':
				if (typeof (msg.name) != 'string' || msg.name == '' || msg.name.trim() != msg.name)
					return { code: 'malformed' };
				if (!loggedIn) {
					const name = JSON.stringify(msg.name);
					client.tagLog(name.substring(1, name.length - 1)), loggedIn = true;
				}
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
	private handleAdminMessage(client: mws.ClientSocket, msg: any): { code: string } {
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
	private async fetchBody(client: mws.ClientRequest, path: string): Promise<string | null> {
		const fullPath = this.fileAssets(path);

		/* look for the file */
		try {
			const data: Buffer | null = await this.cache.read(fullPath);
			if (data == null) {
				client.respondInternalError(`Failed to find content [${fullPath}]`);
				return null;
			}
			return data.toString('utf-8');
		}
		catch (err: any) {
			client.respondInternalError(`Failed to read content [${fullPath}]: ${err.message}`);
			return null;
		}
	}
	private staticPath(client: mws.ClientRequest, path: string): string {
		return client.makeImmutable(this.name, mws.joinSanitized('/static', path));
	}
	private async buildClientPage(client: mws.ClientRequest): Promise<void> {
		if (client.requireMethod('GET') == null)
			return;

		/* read the body */
		const body: string | null = await this.fetchBody(client, '/client.html');
		if (body == null)
			return;

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'de',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.Title('Normaler Mitspieler!'),
				b.AddScript(`window.__CSS_URL_DK = '${this.staticPath(client, '/dk-flag-feature.svg')}';`),
				b.AddScript(`window.__CSS_URL_KH = '${this.staticPath(client, '/kh-flag-feature.svg')}';`),
				b.AddScript(`window.__SOCKET = '${client.makePath('/ws-client')}';`),
				b.LoadStyle(this.staticPath(client, '/client/style.css')),
				b.LoadScript(this.staticPath(client, '/client/script.js')),
			],
			body: [
				b.Embed(body, true)
			]
		});
		client.respondHtml(page, { status: mws.Status.Ok });
	}
	private async buildAdminPage(client: mws.ClientRequest): Promise<void> {
		if (client.requireMethod('GET') == null)
			return;

		/* read the body */
		const body: string | null = await this.fetchBody(client, '/admin.html');
		if (body == null)
			return;

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'de',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.Title('Spiel Kontrolle!'),
				b.AddScript(`window.__SOCKET = '${client.makePath('/ws-admin')}';`),
				b.LoadStyle(this.staticPath(client, '/admin/style.css')),
				b.LoadScript(this.staticPath(client, '/admin/script.js'))
			],
			body: b.Embed(body, true)
		});
		client.respondHtml(page, { status: mws.Status.Ok });
	}
	private async buildScorePage(client: mws.ClientRequest): Promise<void> {
		if (client.requireMethod('GET') == null)
			return;

		/* read the body */
		const body: string | null = await this.fetchBody(client, '/score.html');
		if (body == null)
			return;

		const b = mws.build;
		const page = new b.HtmlPage({
			language: 'de',
			head: [
				b.Meta('viewport', 'width=device-width, initial-scale=1'),
				b.AddScript(`window.__SOCKET = '${client.makePath('/ws-score')}';`),
				b.Title('Punktestand'),
				b.LoadStyle(this.staticPath(client, '/score/style.css')),
				b.LoadScript(this.staticPath(client, '/score/script.js'))
			],
			body: b.Embed(body, true)
		});
		client.respondHtml(page, { status: mws.Status.Ok });
	}

	protected override async handleRequest(client: mws.ClientRequest): Promise<void> {
		client.trace(`Game handler for [${client.path}]`);

		/* check if its a web-socket request (await acceptance to ensure the stop
		*	method is not entered before the full accept has been performed) */
		if (client.path == '/ws-client') {
			const ws = await client.acceptWebSocket();
			if (ws != null)
				await this.acceptWebSocket(ws, ConnectionType.player);
			return;
		}
		if (client.path == '/ws-admin') {
			const ws = await client.acceptWebSocket();
			if (ws != null)
				await this.acceptWebSocket(ws, ConnectionType.admin);
			return;
		}
		if (client.path == '/ws-score') {
			const ws = await client.acceptWebSocket();
			if (ws != null)
				await this.acceptWebSocket(ws, ConnectionType.score);
			return;
		}

		/* check if its one of the html endpoints and build them dynamically */
		if (client.path == '/')
			return this.buildClientPage(client);
		if (client.path == '/admin')
			return this.buildAdminPage(client);
		if (client.path == '/score')
			return this.buildScorePage(client);

		/* check if its just static content to be served */
		if (client.isInsideOf('/static') && client.requireMethod('GET') != null)
			await client.tryRespondFile(this.fileStatic(client.getChildPath('/static')));
	}
	protected override async handleStop(): Promise<void> {
		const promises: Promise<void>[] = [];

		/* safe to iterate, even it it may be removed in the close call */
		for (const client of this.connected)
			promises.push(client.close());
		await Promise.all(promises);
	}
}
