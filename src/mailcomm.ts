import assert from 'assert';
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

import { ROOT, config } from './app';
import { pool } from './libs/db';
import { POP3Socket, sendMail } from './libs/email';
import { type LOGGER_TYPE, getLogger } from './libs/log';
import { PRF } from './libs/prf';
import { checkIntRange, getNextNumber, isDigit, sleep } from './util';

let LOGGER: LOGGER_TYPE, LOGGER_STAGE: LOGGER_TYPE;

const
	DURATION = 30_000,
	THU_SUFFIX = '@mails.tsinghua.edu.cn';

let LC_PATH: string;
let lastCheck = 0;

async function checkMailBox() {
	LOGGER_STAGE('checking box ...');
	const socket = new POP3Socket();
	let n;
	try {
		n = await socket.login();
	} catch (e) {
		LOGGER_STAGE(e);
		return socket.close();
	}
	LOGGER_STAGE('all %o -> %o emails', lastCheck, n);

	for (; lastCheck < n;) {
		await writeFile(LC_PATH, `${++lastCheck}\n`);
		LOGGER('checking email #%o ...', lastCheck);
		let email;
		try {
			email = await socket.retrieve(lastCheck);
		} catch (e) {
			LOGGER(e);
			continue;
		}

		let year = 0, _uid = '', _id = 0;
		let uid = '', name = '', qq = 0, id = 0;
		let textBuffered: Buffer;
		try {
			const from = email.from!;
			const address = from.value[0].address!;

			assert(address.endsWith(THU_SUFFIX));
			uid = address.slice(0, -THU_SUFFIX.length);
			assert(uid.length > 3);
			year = Number(uid.slice(-2));
			assert(checkIntRange(year, 0, 99));
			year += 2000;
			name = from.value[0].name;
		} catch (e) {
			LOGGER(new TypeError('非验证性邮件', { cause: e }));
			continue;
		}
		try {
			textBuffered = Buffer.from(email.text!);
			const isQ = (x: number) => x === 81 || x === 113;
			for (let i = 0; i + 3 < textBuffered.length; ++i) {
				if (isQ(textBuffered[i]) && isQ(textBuffered[i + 1])) {
					const t = getNextNumber(textBuffered.subarray(i + 2));
					if (t > 0) {
						qq = t;
						break;
					} else {
						i -= t;
					}
				}
			}
			if (!qq) {
				LOGGER('找不到 qq 号');
				continue;
			}

			for (let i = 0; (i = textBuffered.indexOf(`${year}01`, i)) >= 0; ++i) {
				if (!isDigit(textBuffered[i - 1]) &&
					isDigit(textBuffered[i + 6]) &&
					isDigit(textBuffered[i + 7]) &&
					isDigit(textBuffered[i + 8]) &&
					isDigit(textBuffered[i + 9]) &&
					!isDigit(textBuffered[i + 10])) {
					_id = Number(textBuffered.subarray(i, i + 10));
					break;
				}
			}
		} catch (e) {
			LOGGER(new TypeError('格式错误', { cause: e }));
			continue;
		}

		LOGGER({ year, _id, uid, name, qq });

		try {
			const result = await pool.query({
				name: 'fetch-id-from-name-strict',
				text: 'select id from thudb where uid = $1 and name = $2',
				values: [uid, name]
			});
			if (result.rowCount !== result.rows.length) { LOGGER('db q1 error'); continue; }
			if (result.rowCount === 1) {
				id = result.rows[0].id;
				_uid = uid;
			}
		} catch { }

		if (!id) {
			try {
				const result = await pool.query({
					name: 'fetch-id-from-name',
					text: 'select id, uid from thudb where id between $1 and $2 and name = $3',
					values: [year * 1000000 + 10001, year * 1000000 + 999999, name]
				});
				if (result.rowCount !== result.rows.length) { LOGGER('db q2 error'); continue; }
				if (result.rowCount === 1) {
					id = result.rows[0].id;
					if ((_uid = result.rows[0].uid).length > 3)
						uid = _uid;
				} else if (result.rowCount > 1 && _id) {
					// 需要额外信息
					const result = await pool.query({
						name: 'unambiguous-check-id-name',
						text: 'select id, uid from thudb where id = $1 and name = $2',
						values: [_id, name]
					});
					if (result.rowCount !== result.rows.length) { LOGGER('db q3 error'); continue; }
					if (result.rowCount === 1) {
						id = _id;
						if ((_uid = result.rows[0].uid).length > 3)
							uid = _uid;
					}
				}
			} catch { }
		}

		if (!id) {
			LOGGER('not found');
			continue;
		}

		LOGGER({ year, id, uid, name, qq });
		if (uid.length > 12) {
			LOGGER('%o is too long', { uid });
			continue;
		}

		if (_uid !== uid) {
			LOGGER('update %o to %o', { uid: _uid }, { uid });
			await pool.query({
				name: 'update-uid',
				text: 'update thudb set uid = $1 where id = $2',
				values: [uid, id]
			});
		}

		const
			time = Math.floor(new Date().getTime() / (config.security.tokenExpire * 1e3)),
			prf = PRF(id, uid, qq, time);
		LOGGER(' -> prf = %o', prf);
		await sendMail({
			to: { name, address: `${qq}@qq.com`, },
			subject: '新生群自动审核验证码',
			html: `<style>\
code{background-color:rgba(0,0,0,.08);border-radius:3px;display:inline-block;font-family:Menlo,Monaco,Consolas,Courier New,monospace;font-size:.857142857rem;padding:1px 4px}\
</style>\
<p>${name} 同学您好！</p><p>您正在使用 xxxx 新生群自动审核功能，</p>\
<p>请再次确认您的个人信息无误：您的学号为 ${id}，用户名为 ${uid}。</p>\
<p>加群的验证码 (即回答的问题) 为 <code>${prf}</code>，有效期 60 分钟。</p>\
<p>如遇到困难，请联系 <a href="mailto:${config.contact.name}&lt;${config.contact.address}&gt;">${config.contact.address}</a> 或直接在审核群里提出。</p>\
<p>（注：若非本人操作，请忽略此邮件）</p>`
		});
	}

	LOGGER_STAGE('closing connection ...');
	socket.close();
}

export async function mailServer() {
	LOGGER = getLogger('mailServer');
	LOGGER_STAGE = getLogger('mailServer:stage');

	try {
		LC_PATH = resolve(ROOT, 'lastCheck');
		lastCheck = Number(await readFile(LC_PATH, 'utf8'));
		if (!checkIntRange(lastCheck, 0, 2147483647))
			lastCheck = 0;
	} catch { }
	getLogger('mailServer:bootstrap')('lastCheck = %o', lastCheck);

	for (; ;) {
		await checkMailBox().catch(LOGGER);
		await sleep(DURATION);
	}
}
