import { WebSocket } from 'ws';

import { CommandExecutedEvent } from '../qq';
import { LOGGER_TYPE, getLogger } from '../libs/log';

let LOGGER: LOGGER_TYPE;

export function register(ws: WebSocket) {
	LOGGER = getLogger('qqBotServer:cardLint');
	ws.send(JSON.stringify({
		syncId: '',
		command: 'cmd_register',
		content: {
			name: 'card-lint',
			alias: ['card-clippy'],
			usage: '/card-lint',
			description: '群名片规范检查器',
		},
	}));
}

export async function handle(event: CommandExecutedEvent, ws: WebSocket, syncId: number, sessionKey: Promise<string>) {
	// todo!()
}