export function liveRpcSkipReason(platform, live, offline) {
 if (offline) return '오프라인 설정(LAZYNEON_OFFLINE=1 또는 config/local.json "offline": true): 실시간 RPC 검사 안 함 (--live보다 우선)';
 if (platform === 'win32') return 'Windows live RPC 미지원 — 정적 검사만 수행 (--live 포함)';
 return live ? 'language_server 미감지 (헤드리스 — 정적 검사만 수행)' : '실시간 RPC 검사 안 함 (--live 지정 시에만 실행 중인 Antigravity에 접속)';
}

export function pythonVersionStatus(text) {
 const match = /^Python (\d+)\.(\d+)(?:\.|$)/.exec(text.trim());
 return match && (Number(match[1]) > 3 || Number(match[1]) === 3 && Number(match[2]) >= 10) ? 'ok' : 'warn';
}
