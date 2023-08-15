import pg from 'pg';
import Pool = pg.Pool;
import QueryConfig = pg.QueryConfig;

import { config } from '../app';
import { getLogger, type LOGGER_TYPE } from './log';

let LOGGER: LOGGER_TYPE;

export let pool: Pool;

export const
	BEGIN: QueryConfig = { name: 'BEGIN', text: 'BEGIN' },
	ROLLBACK: QueryConfig = { name: 'ROLLBACK', text: 'ROLLBACK' },
	COMMIT: QueryConfig = { name: 'COMMIT', text: 'COMMIT' };

export function bootstrap() {
	LOGGER = getLogger('db');
	pool = new Pool(config.database);
	LOGGER('pool created');
}
