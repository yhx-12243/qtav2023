import { WebSocket, type RawData } from 'ws';

import { config } from './app';
import { handleMemberJoin, type MemberJoinRequestEvent } from './bot/handleMemberJoin';
import { register as cardLintRegister, handle as handleCardLint } from './bot/cardLint';
import { register as codeVerifyRegister, handle as handleCodeVerify } from './bot/cardLint';
import { getLogger, type LOGGER_TYPE } from './libs/log';

let LOGGER: LOGGER_TYPE;

interface Message {
	syncId: number | '';
	data: SessionKeyEvent | MemberJoinRequestEvent | CommandExecutedEvent;
}

interface SessionKeyEvent {
	code: number;
	session: string;
}

export interface CommandExecutedEvent {
	type: 'CommandExecutedEvent';
	eventId: number;
	/** Command name. */
	name: string;
	friend: object;
	member: object;
	args: object[];
}

export function qqAdapter() {
	LOGGER = getLogger('qqBotServer');

	const ws = new WebSocket(`ws://localhost:${config.mirai.port}/all?verifyKey=${config.mirai.verifyKey}&qq=${config.mirai.qq}`);
	const noop: (x: string) => void = () => { };
	let setSessionKey: (x: string) => void;
	const sessionKey = new Promise<string>(set => setSessionKey = set);

	ws.on('message', async (data: RawData) => {
		let event: Message
		try {
			event = JSON.parse(<string><unknown>data);
		} catch (e) {
			LOGGER(e);
			return;
		}

		if (event.syncId === '') {
			const sk = (<SessionKeyEvent>event.data).session;
			if (sk) {
				LOGGER('receive %o', { sessionKey: sk });
				setSessionKey(sk);
				setSessionKey = noop;
				cardLintRegister(ws);
				codeVerifyRegister(ws);
			}
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		switch ((<any>event.data)?.type) {
			case 'MemberJoinRequestEvent': {
				const join = <MemberJoinRequestEvent>event.data;
				await handleMemberJoin(join, ws, event.syncId, sessionKey);
				break;
			}
			case 'CommandExecutedEvent': {
				const ctx = <CommandExecutedEvent>event.data;
				LOGGER('receive command %o', ctx);
				switch (ctx.name) {
					case 'card-lint': {
						await handleCardLint(ctx, ws, event.syncId, sessionKey);
						break;
					}
					case 'code-verify': {
						await handleCodeVerify(ctx, ws, event.syncId, sessionKey);
						break;
					}
				}
				break;
			}
		}
	})
		.on('close', (code: number, reason: Buffer) => {
			LOGGER('websocket closed: %o', { code, reason: reason.toString() });
			process.exit(1);
		});
}
