import { WebSocket } from 'ws';

import { CommandExecutedEvent } from '../qq';
import { LOGGER_TYPE, getLogger } from '../libs/log';

let LOGGER: LOGGER_TYPE;

export function register(ws: WebSocket) {
	LOGGER = getLogger('qqBotServer:codeVerify');
	ws.send(JSON.stringify({
		syncId: '',
		command: 'cmd_register',
		content: {
			name: 'code-verify',
			alias: [],
			usage: '/code-verify [qq]',
			description: '检查验证码可用性',
		},
	}));
}

export async function handle(event: CommandExecutedEvent, ws: WebSocket, syncId: number, sessionKey: Promise<string>) {
	// todo!()
}
