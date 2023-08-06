import { WebSocket } from 'ws';

import { CommandExecutedEvent } from '../qq';

export function register(ws: WebSocket) {
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

export async function handleCardLint(event: CommandExecutedEvent, ws: WebSocket, syncId: number, sessionKey: Promise<string>) {
	// todo!()
}
