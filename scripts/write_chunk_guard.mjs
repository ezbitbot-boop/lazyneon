#!/usr/bin/env node
/**
 * write_chunk_guard.mjs — PreToolUse silent-stream cutoff guard
 * Blocks oversized single writes (>24KB or >250 lines by default) before Antigravity
 * hits the 60-second silent-stream cutoff (antigravity-cli #1255).
 * Override via LAZYNEON_MAX_WRITE_BYTES / LAZYNEON_MAX_WRITE_LINES or disable via LAZYNEON_DISABLE_WRITE_CHUNK_GUARD=1.
 */
import { hostLimits, trustedHost } from "./long-output.mjs";
import { stdin } from "node:process";
import { isReadOnlyTool } from "./hook_targets.mjs";

const DEFAULT_MAX_BYTES = 24 * 1024;
const DEFAULT_MAX_LINES = 250;

// A complete JSON payload resolves at once (early resolve below), so the cap only matters when the host
// sends late. At 50ms a late payload was dropped and the write was allowed unchecked, hence 1500ms.
const STDIN_WAIT_MS = 1500;

function readStdin(limitMs = STDIN_WAIT_MS) {
	return new Promise((resolve) => {
		if (stdin.isTTY) return resolve("");
		const chunks = [];
		let settled = false;
		const finish = (val) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				stdin.pause();
			} catch {}
			stdin.removeAllListeners();
			resolve(val);
		};
		const timer = setTimeout(() => finish(Buffer.concat(chunks).toString("utf8")), limitMs);
		if (typeof timer.unref === "function") timer.unref();
		stdin.on("data", (c) => {
			chunks.push(c);
			const acc = Buffer.concat(chunks).toString("utf8").trim();
			if ((acc.startsWith("{") && acc.endsWith("}")) || (acc.startsWith("[") && acc.endsWith("]"))) {
				try {
					JSON.parse(acc);
					finish(acc);
				} catch {}
			}
		});
		stdin.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
		stdin.on("error", () => finish(""));
	});
}

function tryParseJson(text) {
	if (!text || typeof text !== "string") return undefined;
	const t = text.trim();
	if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
	try {
		return JSON.parse(t);
	} catch {
		return undefined;
	}
}

function resolveToolArgs(payload) {
	if (!payload || typeof payload !== "object") return null;
	let args =
		payload.toolCall?.args ??
		payload.toolCall?.arguments ??
		payload.tool_input ??
		payload.input ??
		payload.args ??
		payload.parameters ??
		payload;
	if (typeof args === "string") args = tryParseJson(args) || { patch: args };
	return args && typeof args === "object" ? args : null;
}

export function extractTargetFile(payload) {
	const args = resolveToolArgs(payload);
	if (!args) return "";
	for (const k of [
		"Path",
		"TargetFile",
		"target_file",
		"file_path",
		"filepath",
		"path",
		"target_path",
		"targetpath",
		"output",
		"file",
		"filename",
	]) {
		if (typeof args[k] === "string" && args[k].trim()) return args[k].trim();
	}
	return "";
}

export function extractWriteBody(payload) {
	if (isReadOnlyTool(payload)) return "";
	const args = resolveToolArgs(payload);
	if (!args) return "";

	const parts = [];
	function visit(node, depth = 0) {
		if (depth > 8) throw new Error("write arguments exceed inspection depth 8");
		if (typeof node === "string") {
			const decoded = tryParseJson(node);
			if (decoded) visit(decoded, depth + 1);
			else parts.push(node);
		} else if (node && typeof node === "object") {
			for (const [key, value] of Object.entries(node)) {
				// Match text and path metadata are not replacement bytes.
				if (/^(target|old_str|old_string|old_text|path|file_path|targetfile|filename|tool_name|name)$/i.test(key) && typeof value === "string") continue;
				if (/^(command|cmd|command_line|commandline|script)$/i.test(key) && typeof value === "string") {
					// Bound every command payload, including stdin and encoded writes.
					parts.push(value);
				} else visit(value, depth + 1);
			}
		}
	}
	visit(args);
	return parts.join("\n");
}

export const extractWriteContent = extractWriteBody;

function allow() {
	// No decision on pass-through: leave other hooks and host approval in control.
	process.stdout.write("{}\n");
	process.exit(0);
}

function deny(reason) {
	console.error(`[WRITE CHUNK GUARD] BLOCKED: ${reason}`);
	process.stdout.write(`${JSON.stringify({ decision: "deny", reason })}\n`);
	process.exit(1);
}

async function main() {
	// Read the payload even when disabled: exiting with it unread breaks the host's pipe (EPIPE) once
	// it outgrows the OS pipe buffer (16 KB on macOS).
	const raw = process.env.ANTIGRAVITY_TOOL_INPUT || process.env.TOOL_INPUT || (await readStdin(STDIN_WAIT_MS));
	if (process.env.LAZYNEON_DISABLE_WRITE_CHUNK_GUARD === "1") allow();
	const payload = tryParseJson(raw);
	const limits = hostLimits(trustedHost());
 const content = extractWriteContent(payload);
	if (!content) allow();

	const maxBytes = Number.parseInt(process.env.LAZYNEON_MAX_WRITE_BYTES || "", 10) || limits.max_write_bytes || DEFAULT_MAX_BYTES;
	const maxLines = Number.parseInt(process.env.LAZYNEON_MAX_WRITE_LINES || "", 10) || limits.max_write_lines || DEFAULT_MAX_LINES;
	const bytes = Buffer.byteLength(content, "utf8");
	const lines = content.split(/\r?\n/).length;

	if (bytes > maxBytes || lines > maxLines) {
		deny(
			`stream cutoff guard: write payload is ${lines} lines / ${bytes}B (limit: ${maxLines} lines / ${maxBytes}B). Split into chunks <=100 lines and <20KB.`,
		);
	}
	allow();
}

main().catch(error => deny(`stream cutoff guard: cannot inspect write payload: ${error.message}`));
