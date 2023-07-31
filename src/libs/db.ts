import pg from 'pg';
import Pool = pg.Pool;

import { type LOGGER_TYPE, getLogger } from './log';
import { config } from '../app';

let LOGGER: LOGGER_TYPE;

export let pool: Pool;

export function bootstrap() {
	LOGGER = getLogger('db');
	pool = new Pool(config.database);
	LOGGER('pool created');
}
