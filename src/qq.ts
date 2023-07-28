import { WebSocket } from 'ws';

import { getLogger } from './libs/log';
import { config } from './app';

const LOGGER = getLogger('qqBotServer');

export function qqAdapter() {
	// const ws = new WebSocket(`ws://localhost:${config.mirai.port}/event?verifyKey=${config.mirai.verifyKey}&qq=${config.mirai.qq}`);
	

}
