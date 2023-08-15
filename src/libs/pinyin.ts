import { pinyin } from 'pinyin-pro';

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
export function getAvailableUid(name: string) {
	const py = [...name].map(getPinyinsForChar);
	const surname = py[0], firstname = py.slice(1).reduce(outerProduct);
	return (<string[]>[]).concat(
		outerProduct(surname, firstname),
		outerProduct(firstname, surname)
	);
}
