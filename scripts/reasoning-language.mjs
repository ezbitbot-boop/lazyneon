// Opt-in guidance, not a claim about the model's hidden reasoning language.
const GENERAL_KINDS = new Set(['general', 'implementation', 'long_execution']);
const PROTECTED = /legal|forensic|sensitive|pii|security|final_review|evidence|judgment|count_extract|media_transcribe|verdict|audit/i;
const PROTECTED_PROMPT = /\b(?:legal|law|lawsuit|litigation|contract|forensic\w*|evidence|evidentiary|pii|sensitive|security|audit|testimony|affidavit|chain of custody)\b|법률|법적|법원|계약|소송|판결|증거|증빙|입증|포렌식|감정서|개인정보|개인 정보|민감|보안|녹취|원본|진위|위변조/i;
export function reasoningLanguage(prompt, kind, matchedKinds, env = process.env) {
 if (env.LAZYNEON_REASONING_LANG !== 'en' || !GENERAL_KINDS.has(kind)) return 'ko';
 if (matchedKinds.some(k => PROTECTED.test(k)) || PROTECTED_PROMPT.test(prompt)) return 'ko';
 return 'en';
}
export const ENGLISH_GUIDANCE = 'Reason and draft in English, then write natural Korean. Preserve identifiers and quoted source text; do not expose internal reasoning. If legal, forensic, sensitive/PII, security audit, final review or evidence work emerges, use Korean instead.';
