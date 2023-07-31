import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { type RequestOptions, request as httpRequest, IncomingHttpHeaders } from 'http';
import { request as httpsRequest } from 'https';
import pg from 'pg';
import Client = pg.Client;
import { pinyin } from 'pinyin-pro';

import config from '../config.json' assert { type: 'json' };

const conn = new Client(config.database);
await conn.connect();

function request(config: RequestOptions & { end: boolean }): Promise<[IncomingHttpHeaders, Buffer]> {
	return new Promise((fulfill, reject) => {
		const req = (config.protocol!.includes('https') ? httpsRequest : httpRequest)(config, res => {
			const buffers: Buffer[] = [];
			res.on('data', (chunk: Buffer) => buffers.push(chunk));
			res.on('end', () => fulfill([res.headers, Buffer.concat(buffers)]));
		}).on('error', reject);
		if (config.end) req.end();
	});
}

type thudbEntry = { id: number, uid: string, name: string, fid: number };
type facultyEntry = { id: number, name: string };

const
	thudb: thudbEntry[] = (await conn.query('select * from thudb')).rows,
	faculty: facultyEntry[] = (await conn.query('select * from thudb_faculty')).rows,
	thudb_dict: Record<number, thudbEntry> = {},
	faculty_dict_by_id: Record<number, facultyEntry> = {},
	faculty_dict: Record<string, facultyEntry> = {};

function initExistingData() {
	const faculty_aliases: Record<string, string> = JSON.parse(readFileSync('aliases.json', 'utf8'));
	for (const entry of thudb) thudb_dict[entry.id] = entry;
	for (const entry of faculty) faculty_dict_by_id[entry.id] = faculty_dict[entry.name] = entry;
	for (const [key, val] of Object.entries(faculty_aliases)) faculty_dict[key] = faculty_dict[val];
}

async function parseHtmlData(path = 'cor.html') {
	initExistingData();
	const
		data: { id: number, name: string, faculty: string }[] = [],
		errs = new Set(),
		data_reg = /^\s*<option value="(\d+)">(\d+)\/(.+)\/([^</]+)<\/option>\s*$/;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const match = line.match(data_reg);
		if (!match) continue;
		try {
			assert.strictEqual(match[1], match[2]);
			const id = Number(match[1]);
			assert(Number.isSafeInteger(id));
			if (id < 2018e6) continue;
			const name = match[3];
			const faculty = match[4];
			if (!faculty_dict[faculty]) {
				errs.add(faculty);
				continue;
			}
			data.push({ id, name, faculty });
		} catch (e) {
			console.log(line);
		}
	}
	// console.log(errs);

	for (const { id, name, faculty } of data) {
		const fentry = faculty_dict[faculty];
		assert(fentry);
		const eentry = thudb_dict[id];
		if (eentry) {
			assert(eentry.id === id);
			if (eentry.name === name && eentry.fid === fentry.id) {
				// pass
			} else {
				if (eentry.name === name) {
					// transfer faculty
					await conn.query('update thudb set fid = $1 where id = $2', [fentry.id, id]);
				} else {
					console.log('%o : [%o, %o] => [%o, %o]', id, eentry.name, faculty_dict_by_id[eentry.fid], name, fentry);
					await conn.query('update thudb set name = $1, fid = $2 where id = $3', [name, fentry.id, id]);
				}
			}
		} else {
			console.log('insert %o : [%o, %o]', id, name, fentry);
			await conn.query('insert into thudb values ($1, \'\', $2, $3)', [id, name, fentry.id]);
		}
	}
}

const __pinyin_for_char_cache__: Record<string, string[]> = {};
function getPinyinsForChar(char: string) {
	if (__pinyin_for_char_cache__[char]) return __pinyin_for_char_cache__[char];
	const result = pinyin(char, { multiple: true, nonZh: 'removed', toneType: 'none', type: 'array', v: true });
	if (!result.length) result.push('');
	return __pinyin_for_char_cache__[char] = [...new Set(result.concat(result.map(py => py[0])))].sort();
}

function outerProduct(arr1: string[], arr2: string[]) { return arr1.flatMap(x => arr2.map(y => x + y)); }

/**
 *	拆分方式 (以陈墨涵为例)
 *	(c|chen)-?(mh|mohan)		8 种
 *	或
 *	(mh|mohan)-?(c|chen)		8 种
 *	[:8]
 */
function getAvailableUid(name: string) {
	const py = [...name].map(getPinyinsForChar);
	const surname = py[0], firstname = py.slice(1).reduce(outerProduct);
	return (<string[]>[]).concat(
		outerProduct(surname, firstname),
		outerProduct(firstname, surname)
	);
}

const STOP = '@0';
async function fetchUid(sessionid = config.thudb.tokens.cloudSessionId) {
	const noUID = [];

	for (const entry of thudb) {
		const year = Math.floor(entry.id / 1e6) % 100;
		if (entry.uid.length > 1 && entry.uid != STOP) {
			try {
				if (!entry.uid.endsWith(year.toString().padStart(2, '0'))) throw new Error('UID 与年份不匹配');
				const mainPart = entry.uid.slice(0, -2);
				if (mainPart.length > 8) throw new Error('UID 太长了');
				const uids = getAvailableUid(entry.name), nonDash = mainPart.replaceAll('-', '');
				if (!uids.some(uid => uid.startsWith(nonDash))) throw new Error('UID 非规范');
			} catch (e) {
				console.log((<Error>e).message + ':', entry);
			}
		} else if (entry.uid != STOP) { // no uid
			if (entry.id % 1e6 < 5e5) {
				noUID.push(entry);
			}
		}
	}
	const promises = [];
	let stamp = 0;
	for (const entry of noUID) {
		promises.push(
			request({
				end: true,
				headers: {
					cookie: `sessionid=${sessionid}`
				},
				host: 'cloud.tsinghua.edu.cn',
				path: `/api2/search-user/?q=${entry.id}@tsinghua.edu.cn`,
				protocol: 'https:'
			}).then(async ([, data_raw]) => {
				let data: { users: { contact_email: string }[] };
				try {
					data = JSON.parse(<string><unknown>data_raw);
				} catch (e) {
					return console.log(entry, data_raw, e);
				}
				const originalUID = entry.uid;
				if (!data.users?.length) entry.uid = STOP;
				else {
					const user = data.users[0], id = typeof user.contact_email === 'string' ? user.contact_email.split('@', 1)[0] : STOP;
					entry.uid = (id === entry.id.toString() ? STOP : id);
				}
				console.log('%o: %o => %o', entry.id, originalUID, entry.uid);
				await conn.query('update thudb set uid = $1 where id = $2', [entry.uid, entry.id]);
			}, err => {
				console.log(entry, err);
			})
		);
		await Promise.all(promises);
		if (++stamp % 100 === 0) {
			console.log('sleeping %o / %o ...', stamp, noUID.length);
			await new Promise(fulfill => setTimeout(fulfill, 2000));
		}
	}
}

async function fetchFromGitTsinghua(token = config.thudb.tokens.gitTsinghua) {
	type Data = { name: string, username: string };
	const datalist: Data[][] = []; let flags = true;
	for (let page = 1; flags; ++page) {
		console.log('page', page);
		await request({
			end: true,
			headers: {
				'private-token': token
			},
			host: 'git.tsinghua.edu.cn',
			path: `/api/v4/users?page=${page}&per_page=100`,
			protocol: 'https:'
		}).then(async ([, data_raw]) => {
			let data: Data[];
			try {
				data = JSON.parse(<string><unknown>data_raw);
			} catch (e) {
				return console.log(page, data_raw, e);
			}
			console.log('\tlength =', data.length);
			if (data.length) datalist.push(data);
			else flags = false;
		}, err => {
			console.log(page, err);
		})
		if (page % 50 === 0) {
			console.log('sleeping ...');
			await new Promise(fulfill => setTimeout(fulfill, 4000));
		}
	}
	const
		datas = datalist.flat(),
		uid_reg = /^\D+(\d{2})$/;
	for (const { name, username } of datas) {
		const match = username.match(uid_reg);
		if (!match) continue;

		const year = Number(match[1]);
		if (year < 18) continue;

		let candidates = thudb.filter(
			entry => entry.name === name && Math.floor(entry.id / 1e6) % 100 === year
		);
		if (candidates.some(entry => entry.uid === username)) continue;
		candidates = candidates.filter(entry => entry.uid === '' || entry.uid === STOP);
		if (!candidates.length) continue;
		if (candidates.length === 1) {
			await conn.query('update thudb set uid = $1 where id = $2', [username, candidates[0].id]);
		}
		console.log(name, username, candidates);
	}
}

const exit = () => process.exit(0);

// parseHtmlData().then(exit);

// fetchUid().then(exit);

// fetchFromGitTsinghua().then(exit);

export { thudb };
