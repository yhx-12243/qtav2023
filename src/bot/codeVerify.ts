import { WebSocket } from 'ws';

import { CommandExecutedEvent } from '../qq';
import { LOGGER_TYPE, getLogger } from '../libs/log';
import { genSyncId } from '../util';

let LOGGER: LOGGER_TYPE;

export function register(ws: WebSocket) {
	LOGGER = getLogger('qqBotServer:codeVerify');
	ws.send(JSON.stringify({
		syncId: genSyncId(),
		command: 'cmd_register',
		content: {
			name: 'code-verify',
			alias: [],
			usage: '/code-verify [qq]',
			description: '检查验证码可用性',
		},
	}));
}

export async function handle(event: CommandExecutedEvent, ws: WebSocket, sessionKey: Promise<string>) {
	// todo!()
}
