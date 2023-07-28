import debug from 'debug';
import { appendFile, mkdirSync } from 'fs';
import { resolve } from 'path';
import { format } from 'util';

import { ROOT } from '../app';

let LOGGER_PATH: string;

export function bootstrap() {
	LOGGER_PATH = resolve(ROOT, 'logs', new Date().toISOString() + '.log');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function teeLogger(...args: any[]) {
	mkdirSync(resolve(ROOT, 'logs'), { recursive: true });
	appendFile(LOGGER_PATH, format(...args) + '\n', () => { });
}

export function getLogger(namespace: string) {
	const LOGGER = <debug.Debugger & { useColors: boolean }>debug(namespace);
	LOGGER.log = teeLogger;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (...args: [any, ...any]) => {
		LOGGER.useColors = true;
		LOGGER.log = debug.log;
		LOGGER(...args);
		LOGGER.useColors = false;
		LOGGER.log = teeLogger;
		LOGGER(...args);
	}
}
