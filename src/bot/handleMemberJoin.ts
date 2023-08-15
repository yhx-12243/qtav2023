import { WebSocket } from 'ws';

import { config } from '../app';
import { pool } from '../libs/db';
import { getLogger, type LOGGER_TYPE } from '../libs/log';
import { validate } from '../libs/prf';
import { genSyncId } from '../util';

let LOGGER: LOGGER_TYPE;

export interface MemberJoinRequestEvent {
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

async function _inner(event: MemberJoinRequestEvent): Promise<MemberJoinResult> {
	LOGGER ??= getLogger('qqBotServer:memberJoin');
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

export async function handle(event: MemberJoinRequestEvent, ws: WebSocket, sessionKey: Promise<string>) {
	const res = await _inner(event);
	if (res === MemberJoinResult.IGNORE) return;

	ws.send(JSON.stringify({
		syncId: genSyncId(),
		command: 'resp_memberJoinRequestEvent',
		content: {
			sessionKey: await sessionKey,
			eventId: event.eventId,
			fromId: event.fromId,
			groupId: event.groupId,
			operator: res,
			message: '',
		},
	}));
}
