import { WebSocket, type RawData } from 'ws';

import { config } from './app';
import { pool } from './libs/db';
import { type LOGGER_TYPE, getLogger } from './libs/log';
import { validate } from './libs/prf';

let LOGGER: LOGGER_TYPE;

interface Message {
	syncId: number | '';
	command?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	content?: any;
	data?: {
		code: number;
		session: string;
	};
}

interface MemberJoinRequestEvent {
	type: 'MemberJoinRequestEvent';
	eventId: number;
	fromId: number;
	groupId: number;
	groupName: string;
	nick: string;
	message: string;
	invitorId: number | null;
}

enum MemberJoinResult {
	ACCEPT,
	REJECT,
	IGNORE,
}

async function handleMemberJoin(event: MemberJoinRequestEvent): Promise<MemberJoinResult> {
	try {
		const { fromId: qq, groupId, message } = event;
		if (!config.mirai.groups.includes(groupId)) {
			LOGGER('group %o is not tracked', event.groupId);
			return MemberJoinResult.IGNORE;
		}

		const ct = message.trim(), time = new Date().getTime() / (config.security.tokenExpire * 1e3);

		const r = validate(qq, time, ct);
		if (!r) {
			LOGGER('user %o try to join group %o with \'fake\' code %o, REJECT', qq, groupId, ct);
			return MemberJoinResult.REJECT;
		}

		const { id, uid } = r;
		LOGGER('%o', { qq, groupId, ct, id, uid });

		const result = await pool.query({
			name: 'fetch-name-from-id-uid',
			text: 'select name from thudb where id = $1 and uid = $2',
			values: [id, uid]
		});
		if (result.rowCount !== result.rows.length) {
			LOGGER('db q11 error');
			return MemberJoinResult.IGNORE;
		}
		if (result.rowCount !== 1) {
			LOGGER('db q12 error: not found');
			return MemberJoinResult.IGNORE;
		}

		const name = result.rows[0].name;
		LOGGER(' -> %o, accept!', { name });

		return MemberJoinResult.ACCEPT;
	} catch (e) {
		LOGGER(e);
		return MemberJoinResult.IGNORE;
	}
}

export function qqAdapter() {
	LOGGER = getLogger('qqBotServer');

	const ws = new WebSocket(`ws://localhost:${config.mirai.port}/event?verifyKey=${config.mirai.verifyKey}&qq=${config.mirai.qq}`);
	const noop: (x: string) => void = () => { };
	let setSessionKey: (x: string) => void;
	const sessionKey: Promise<string> = new Promise(set => setSessionKey = set);

	ws.on('message', async (data: RawData) => {
		let event: Message
		try {
			event = JSON.parse(<string><unknown>data);
		} catch (e) {
			LOGGER(e);
			return;
		}

		if (event.syncId === '') {
			const sk = event.data?.session;
			if (sk) {
				LOGGER('receive %o', { sessionKey: sk });
				setSessionKey(sk);
				setSessionKey = noop;
			}
			return;
		}

		if (event.command !== 'resp_memberJoinRequestEvent') return;

		const join = event.content;
		const res = await handleMemberJoin(join);
		if (res === MemberJoinResult.IGNORE) return;

		ws.send(JSON.stringify({
			syncId: event.syncId,
			data: {
				sessionKey: await sessionKey,
				eventId: join.eventId,
				fromId: join.fromId,
				groupId: join.groupId,
				operator: res,
				message: '',
			}
		}));
	})
	.on('close', (code: number, reason: Buffer) => {
		LOGGER('websocket closed: %o', { code, reason: reason.toString() });
		process.exit(1);
	});
}
