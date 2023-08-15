import { WebSocket, type RawData } from 'ws';

import { config } from './app';
import { handle as handleMemberJoin, type MemberJoinRequestEvent } from './bot/handleMemberJoin';
import { register as cardLintRegister, handle as handleCardLint } from './bot/cardLint';
import { register as codeVerifyRegister, handle as handleCodeVerify } from './bot/codeVerify';
import { getLogger, type LOGGER_TYPE } from './libs/log';

let LOGGER: LOGGER_TYPE;

interface Message {
	syncId: string;
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

const queue = new Map<string, (x: Message) => void>();

export function waitingFor(syncId: string) {
	return new Promise<Message>(fulfill => queue.set(syncId, fulfill));
}

export function qqAdapter() {
	LOGGER = getLogger('qqBotServer');

	const ws = new WebSocket(`ws://localhost:${config.mirai.port}/event?verifyKey=${config.mirai.verifyKey}&qq=${config.mirai.qq}`);
	const noop: (x: string) => void = () => { };
	let setSessionKey: (x: string) => void = noop;
	const sessionKey = new Promise<string>(set => setSessionKey = set);

	ws.on('message', async (data: RawData) => {
		let event: Message;
		try {
			event = JSON.parse(<string><unknown>data);
		} catch (e) {
			LOGGER(e);
			return;
		}

		if (queue.has(event.syncId)) {
			return queue.get(event.syncId)!(event);
		}

		{
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const sk = (<any>event.data)?.session;
			if (sk) {
				LOGGER('receive %o', { sessionKey: sk });
				setSessionKey(sk);
				if (setSessionKey !== noop) {
					setSessionKey = noop;
					cardLintRegister(ws);
					codeVerifyRegister(ws);
				} else {
					LOGGER('discard %o', { sessionKey: sk });
				}
				return;
			}
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		switch ((<any>event.data)?.type) {
			case 'MemberJoinRequestEvent': {
				const join = <MemberJoinRequestEvent>event.data;
				await handleMemberJoin(join, ws, sessionKey);
				break;
			}
			case 'CommandExecutedEvent': {
				const ctx = <CommandExecutedEvent>event.data;
				LOGGER('receive command %o', ctx);
				switch (ctx.name) {
					case 'card-lint': {
						await handleCardLint(ctx, ws, sessionKey);
						break;
					}
					case 'code-verify': {
						await handleCodeVerify(ctx, ws, sessionKey);
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
