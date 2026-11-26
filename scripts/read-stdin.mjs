import { stdin } from 'node:process';

/**
 * Hook payload reader shared by every core hook script.
 * Resolves as soon as the bytes read so far form a complete JSON object or array (hosts may keep the pipe
 * open), on end of input, or after `limitMs` with whatever arrived. A TTY or a read error yields ''.
 * Chunks are joined as bytes before decoding, so a multi-byte character split across chunks survives.
 */
export function readStdin(limitMs = 1500) {
	return new Promise((resolve) => {
		if (stdin.isTTY) {
			resolve('');
			return;
		}
		const chunks = [];
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try { stdin.pause(); } catch {}
			stdin.removeAllListeners();
			resolve(value);
		};
		const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), limitMs);
		if (typeof timer.unref === 'function') timer.unref();
		stdin.on('data', (chunk) => {
			chunks.push(chunk);
			const acc = Buffer.concat(chunks).toString('utf8').trim();
			if ((acc.startsWith('{') && acc.endsWith('}')) || (acc.startsWith('[') && acc.endsWith(']'))) {
				try {
					JSON.parse(acc);
					finish(acc);
				} catch {}
			}
		});
		stdin.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
		stdin.on('error', () => finish(''));
	});
}
