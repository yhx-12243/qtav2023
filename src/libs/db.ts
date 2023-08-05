import pg from 'pg';
import Pool = pg.Pool;

import { config } from '../app';
import { getLogger, type LOGGER_TYPE } from './log';

let LOGGER: LOGGER_TYPE;

export let pool: Pool;

export function bootstrap() {
	LOGGER = getLogger('db');
	pool = new Pool(config.database);
	LOGGER('pool created');
}
