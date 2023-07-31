import debug from 'debug';
import { appendFile, mkdirSync } from 'fs';
import { resolve } from 'path';
import { format } from 'util';

import { ROOT } from '../app';

export type LOGGER_TYPE = (...args: any[]) => void;

let LOGGER_PATH: string;

class ColorManager {
	colors: number[];
	initialColors: number[];

	constructor(initialColors: number[]) {
		this.initialColors = initialColors;
		this.colors = [];
	}

	next(namespace: string) {
		if (!this.colors.length) {
			this.colors = this.initialColors.slice();
		}

		let hash = 0;
		for (let i = 0; i < namespace.length; i++) {
			hash = (((hash << 5) - hash) + namespace.charCodeAt(i)) | 0;
		}

		const idx = (hash < 0 ? hash + 4294967296 : hash) % this.colors.length;
		return this.colors.splice(idx, 1)[0];
	}
}

let colorManager: ColorManager;

export function bootstrap() {
	LOGGER_PATH = resolve(ROOT, 'logs', new Date().toISOString() + '.log');
	colorManager = new ColorManager((<{ colors: number[] }><unknown>debug).colors);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function teeLogger(...args: any[]) {
	mkdirSync(resolve(ROOT, 'logs'), { recursive: true });
	appendFile(LOGGER_PATH, format(...args) + '\n', () => { });
}

export function getLogger(namespace: string): LOGGER_TYPE {
	const LOGGER = <debug.Debugger & { useColors: boolean }>debug(namespace);
	LOGGER.log = teeLogger;
	LOGGER.color = <string><unknown>colorManager.next(namespace);
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
