import assert from 'assert';
import EventEmitter from 'events';
import { simpleParser } from 'mailparser';
import { Transporter, createTransport } from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import { SentMessageInfo } from 'nodemailer/lib/smtp-transport/index.js';
import { Interface, createInterface } from 'readline';
import { connect, type TLSSocket } from 'tls';

import { config } from '../app';
import { checkIntRange } from '../util';
import { getLogger } from './log';

const LOGGER = getLogger('email');

let transporter: Transporter<SentMessageInfo>;

export function bootstrap() {
	transporter = createTransport(config.mailer.transport, config.mailer.account);
}

export function sendMail(config: Mail.Options): Promise<SentMessageInfo> {
	return transporter.sendMail(config);
}

export class POP3Socket extends EventEmitter {
	socket: TLSSocket;
	rl: Interface;
	lines: string[];

	constructor() {
		super();
		this.socket = connect(config.mailer.pop3.port, config.mailer.pop3.host);
		this.socket.on('error', LOGGER);
		this.lines = [];
		this.rl = createInterface({
			input: this.socket,
			crlfDelay: Infinity
		});
		this.rl.on('line', line => {
			this.lines.push(line);
			this.emit('activate');
		});
	}

	async readLine() {
		for (; !this.lines.length;) {
			await new Promise(fulfill => this.once('activate', fulfill));
		}
		return this.lines.shift()!;
	}

	async login() {
		this.socket.write(`USER ${config.mailer.pop3.user}\nPASS ${config.mailer.pop3.pass}\n`);
		assert(await this.readLine() === '+OK POP3 ready', 'pop3 error 1st line');
		assert(await this.readLine() === '+OK', 'pop3 error 2nd line');
		const mat = (await this.readLine()).match(/^\+OK (\d+) message\(s\) \[\d+ byte\(s\)\]$/);
		assert(mat, 'pop3 error 3rd line');
		const n = Number(mat[1]);
		if (!checkIntRange(n, 0, 2147483647)) throw new TypeError('pop3 number of emails error');
		return n;
	}

	async retrieve(id: number) {
		this.socket.write(`LIST ${id}\n`);
		const mat = (await this.readLine()).match(/^\+OK (\d+) (\d+)$/);
		assert(mat, `pop3 list ${id} error`);
		assert(mat[1] === id.toString(), `pop3 list ${id} order error`);
		const size = Number(mat[2]);
		if (!checkIntRange(size, 0, 2147483647)) throw new TypeError(`pop3 size of email ${id} error`);
		LOGGER('size of email #%o = %o', id, size);
		if (size > 65536) throw new RangeError(`size of email #${id} [equals to ${size}] is too big, skipped`);
		this.socket.write(`RETR ${id}\n`);
		assert(/^\+OK \d+ octets$/.test(await this.readLine()), `pop3 retrieve ${id} error`);
		const lines = [];
		for (let line; (line = await this.readLine()) !== '.';)
			lines.push(line);
		return simpleParser(lines.join('\n'));
	}

	close() {
		this.socket.end();
	}
}
