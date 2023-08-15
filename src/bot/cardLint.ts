import { WebSocket } from 'ws';

import { config } from '../app';
import { LOGGER_TYPE, getLogger } from '../libs/log';
import provinces from '../libs/provinces';
import { CommandExecutedEvent, waitingFor } from '../qq';
import { BEGIN, COMMIT, pool } from '../libs/db';
import assert from 'assert';
import { genSyncId } from '../util';

let LOGGER: LOGGER_TYPE;
let lastCardLintTime: Date = new Date(0);

enum LintResultLevel {
	ACCEPTED,
	ACCEPTABLE,
	REJECTED,
}

interface MemberInGroupMirai {
	id: number;
	memberName: string;
	years: number[];
}

interface LintResult {
	level: LintResultLevel;
	info: string;
}

export function register(ws: WebSocket) {
	LOGGER = getLogger('qqBotServer:cardLint');
	ws.send(JSON.stringify({
		syncId: genSyncId(),
		command: 'cmd_register',
		content: {
			name: 'card-lint',
			alias: ['card-clippy'],
			usage: '/card-lint',
			description: '群名片规范检查器',
		},
	}));
}

function checkPKU(card: string) {
	const cardLower = card.toLowerCase();
	return ['隔壁', '戈壁', 'p', '北大'].some(p => cardLower.includes(p));
}

export async function lint(members: MemberInGroupMirai[]): Promise<LintResult[]> {
	type Check = { year: number, name: string, idx: number };
	const yearRegex = /^\d\d(?:\.5)?(\/\d\d(?:\.5)?)*[pP]?$/;
	const result = Array.from<LintResult>({ length: members.length })
		.fill({ level: LintResultLevel.REJECTED, info: '未检验' });
	const checks: Check[] = [];
	const names = new Set<string>();
	const reject = (idx: number, info: string) => {
		result[idx] = { level: LintResultLevel.REJECTED, info };
	}
	const acceptable = (idx: number, info: string) => {
		result[idx] = { level: LintResultLevel.ACCEPTABLE, info };
	}
	const accept = (idx: number, info: string) => {
		result[idx] = { level: LintResultLevel.ACCEPTED, info };
	}
	members.forEach((member, idx) => {
		const { id: qq, memberName: card } = member;
		if (Object.hasOwn(config.lint.whitelist, qq)) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			result[idx] = { ...(<any>config.lint.whitelist)[qq] };
			return;
		}
		const arr = card.split(/([+\-＋－\u2010\u2011\u2012\u2013\u2014\u2015\u2212])/);
		if (arr.length < 7) return reject(idx, '格式错误 (段数 < 4)');

		const [year, sp1, prov, sp2, name, sp3] = arr;
		if (!yearRegex.test(year)) return reject(idx, `年份 '${year}' 不规范`);
		if (!provinces.includes(prov)) return reject(idx, `省份 '${prov}' 不存在`);
		const gender = [sp1, sp2, sp3].map(sp => sp == '+' || sp === '＋');
		if (gender[0] !== gender[1] || gender[0] !== gender[2]) return reject(idx, '性别标识符不一致');
		const years = member.years = year.split('/').flatMap(s => {
			const x = parseInt(s);
			return s.endsWith('.5') ? [x, x + 1] : [x];
		});

		years.forEach(year => checks.push({ year, name, idx }));
		names.add(name);
		reject(idx, `姓名 '${name}' 未找到，可能未实名`);
	});

	const conn = await pool.connect();
	await conn.query(BEGIN);
	await conn.query({
		name: 'create-temporary-table',
		text: 'create temporary table lint(name varchar(64) primary key)'
	});
	await conn.query({
		name: 'insert-temporary-data',
		text: 'insert into lint select unnest($1::varchar(64)[])',
		values: [Array.from(names)]
	});
	const queryResult = (await conn.query({
		name: 'select-join-temporary-data',
		text: 'select id, name from thudb natural join lint where id % 1000000 < 500000'
	}));
	assert(queryResult.rowCount === queryResult.rows.length);

	const n2ys = new Map<string, Set<number>>();
	queryResult.rows.forEach(({ id, name }: { id: number, name: string }) => {
		id = Math.floor(id / 1e6) % 100;
		const ys = n2ys.get(name);
		ys ? ys.add(id) : n2ys.set(name, new Set([id]));
	});

	for (const { year, name, idx } of checks) {
		const ys = n2ys.get(name);
		if (!ys) continue;
		if (ys.has(year)) { accept(idx, '检验通过'); continue; }
		if (ys.has(year - 1)) { acceptable(idx, '降转/留级 1 年，检验通过'); continue; }
		if (ys.has(year - 2)) { reject(idx, '降转/留级 2 年，较可疑'); continue; }
		if (ys.has(year - 3)) { reject(idx, '降转/留级 3 年，较可疑'); continue; }
	}

	members.forEach(({ id: _qq, memberName: card, years }, idx) => {
		if (result[idx].level > LintResultLevel.ACCEPTABLE) {
			if (checkPKU(card)) return acceptable(idx, '北大名片默认通过');
			if (years?.includes(24)) return acceptable(idx, '24 级名片默认通过');
		}
	});

	await conn.query(COMMIT);
	conn.release();

	return result;
}

export async function handle(event: CommandExecutedEvent, ws: WebSocket, sessionKey: Promise<string>) {
	// check permission
	const groupId = 0;


	LOGGER('args => %o', event.args);

	const now = new Date();
	if (now.getTime() - lastCardLintTime.getTime() < config.lint.duration * 1e3) {
		const relax = config.lint.duration - (now.getTime() - lastCardLintTime.getTime()) / 1e3;
		ws.send(JSON.stringify({
			syncId: genSyncId(),
			command: 'sendGroupMessage',
			content: {
				sessionKey: await sessionKey,
				target: groupId,
				messageChain: [
					{ type: 'Plain', text: `操作太频繁啦！再休息 ${relax} 秒吧~` },
				],
			},
		}));
		return;
	}
	lastCardLintTime = now;

	let data: MemberInGroupMirai[];
	{
		const syncId = genSyncId();
		ws.send(JSON.stringify({
			syncId,
			command: 'latestMemberList',
			content: {
				sessionKey: await sessionKey,
				target: groupId,
				memberIds: [],
			},
		}));
		const response = <{ code: number, msg: string, data: MemberInGroupMirai[]}><unknown>await waitingFor(syncId);
		LOGGER('%o => %o', { syncId }, response);
		if (response.code !== 0 || response.msg !== '') return;
		data = response.data;
	}

	const result = await lint(data);

	// ws.send(JSON.stringify({
	// 	syncId,
	// 	command: 'sendGroupMessage',
	// 	content: {
	// 		sessionKey: await sessionKey,
	// 		target: 0,
	// 		messageChain: [
	// 			{ type: 'Plain', text: 'hello\n' },
	// 			{ type: 'Plain', text: 'world' },
	// 		]
	// 	},
	// }));
}

/*

[ 以下是 *** 列表： ]

[
	xxxx (2333): 









]



*/
