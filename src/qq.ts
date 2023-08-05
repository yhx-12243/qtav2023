import { WebSocket, type RawData } from 'ws';

import { config } from './app';
import { MemberJoinResult, handleMemberJoin, type MemberJoinRequestEvent } from './bot/handleMemberJoin';
import { getLogger, type LOGGER_TYPE } from './libs/log';

let LOGGER: LOGGER_TYPE;

interface Message {
	syncId: number | '';
	data: SessionKeyEvent | MemberJoinRequestEvent;
}

interface SessionKeyEvent {
	code: number;
	session: string;
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
			}
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		switch ((<any>event.data)?.type) {
			case 'MemberJoinRequestEvent': {
				const join = <MemberJoinRequestEvent>event.data;
				const res = await handleMemberJoin(join);
				if (res === MemberJoinResult.IGNORE) return;

				ws.send(JSON.stringify({
					syncId: event.syncId,
					command: 'resp_memberJoinRequestEvent',
					content: {
						sessionKey: await sessionKey,
						eventId: join.eventId,
						fromId: join.fromId,
						groupId: join.groupId,
						operator: res,
						message: '',
					}
				}));
				break;
			}
		}
	})
		.on('close', (code: number, reason: Buffer) => {
			LOGGER('websocket closed: %o', { code, reason: reason.toString() });
			process.exit(1);
		});
}
