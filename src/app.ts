import { dirname } from 'path';

import { bootstrap as db_bootstrap } from './libs/db';
import { bootstrap as email_bootstrap } from './libs/email';
import { bootstrap as log_bootstrap } from './libs/log';
import { test as prf_test } from './libs/prf';
import { mailServer } from './mailcomm';
import { qqAdapter } from './qq';

export { default as config } from '../config.json' assert { type: 'json' };

export const ROOT = dirname(dirname(process.argv[1]));

log_bootstrap();
db_bootstrap();
email_bootstrap();
prf_test();

mailServer();
qqAdapter();
