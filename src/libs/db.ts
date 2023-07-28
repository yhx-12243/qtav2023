import pg from 'pg';
import Pool = pg.Pool;

import { getLogger } from './log';
import { config } from '../app';

const LOGGER = getLogger('db');

export let pool: Pool;

export function bootstrap() {
	pool = new Pool(config.database);
	LOGGER('pool created');
}
