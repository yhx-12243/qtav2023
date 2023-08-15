import { randomBytes } from 'crypto';

export function sleep(timeout: number) {
	return new Promise(fulfill => setTimeout(fulfill, timeout));
}

export function checkIntRange(value: unknown, low: number, high: number): value is number {
	return Number.isSafeInteger(value) && low <= <number>value && <number>value <= high;
}

export function isDigit(x: number) {
	return 48 <= x && x <= 57;
}

export function getPrevNumber(buffer: Buffer): number {
	const len: number = buffer.length;
	if (len < 5) return 0;

	let i: number;
	for (i = 0; i < 11 && isDigit(buffer[len - i - 1]); ++i);
	if (i < 5 || i >= 11) return 0;

	const u = buffer.subarray(len - i), v = Number(u);
	if (u.toString() === v.toString()) {
		u.fill(0);
		return v;
	}
	return 0;
}

export function getNextNumber(buffer: Buffer): number {
	let i: number;
	for (i = 0; i < 16 && !isDigit(buffer[i]); ++i);
	if (i >= 16) return -4;

	let j: number;
	for (j = i + 1; j < i + 11 && isDigit(buffer[j]); ++j);
	if (j >= i + 11) return -j;

	const u = buffer.subarray(i, j), v = Number(u);
	if (u.toString() === v.toString()) {
		u.fill(0);
		return v;
	}
	return -j;
}

export function genSyncId() {
	return randomBytes(4).toString('hex');
}
