import type { ImageReference, ScanResult } from "./types";

interface Range { start: number; end: number }

function ignoredRanges(markdown: string): Range[] {
  const ranges: Range[] = [];
  let match: RegExpExecArray | null;

  const fence = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2(?:\n|$)|$)/g;
  while ((match = fence.exec(markdown)) !== null) {
    const leading = match[1].length;
    ranges.push({ start: match.index + leading, end: match.index + match[0].length });
  }

  const inline = /`[^`\n]*`/g;
  while ((match = inline.exec(markdown)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  const comments = /<!--[\s\S]*?-->/g;
  while ((match = comments.exec(markdown)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

function insideRanges(index: number, ranges: Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function classify(url: string): { remote: boolean; host?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { remote: true, host: parsed.hostname.toLowerCase().replace(/\.$/, "") };
    }
  } catch {}
  return { remote: false };
}

function parseMarkdownDestination(markdown: string, openParen: number): { url: string; start: number; end: number } | null {
  let i = openParen + 1;
  while (i < markdown.length && /\s/.test(markdown[i])) i++;
  if (i >= markdown.length) return null;

  if (markdown[i] === "<") {
    const start = i + 1;
    let j = start;
    while (j < markdown.length && markdown[j] !== ">" && markdown[j] !== "\n") j++;
    if (j >= markdown.length || markdown[j] !== ">" || j === start) return null;
    return { url: markdown.slice(start, j), start, end: j };
  }

  const start = i;
  let depth = 0;
  let escaped = false;

  while (i < markdown.length) {
    const ch = markdown[i];
    if (escaped) { escaped = false; i++; continue; }
    if (ch === "\\") { escaped = true; i++; continue; }
    if (ch === "\n") return null;
    if (/\s/.test(ch) && depth === 0) break;
    if (ch === "(") { depth++; i++; continue; }
    if (ch === ")") {
      if (depth === 0) break;
      depth--; i++; continue;
    }
    i++;
  }

  if (i === start || depth !== 0) return null;
  return { url: markdown.slice(start, i), start, end: i };
}

export function scanImages(markdown: string): ScanResult {
  const ignored = ignoredRanges(markdown);
  const refs: ImageReference[] = [];
  const opener = /!\[[^\]\n]*\]\(/g;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(markdown)) !== null) {
    if (insideRanges(match.index, ignored)) continue;
    const openParen = match.index + match[0].length - 1;
    const parsed = parseMarkdownDestination(markdown, openParen);
    if (!parsed) continue;
    const info = classify(parsed.url);
    refs.push({ syntax: "markdown", url: parsed.url, start: parsed.start, end: parsed.end, ...info });
  }

  const html = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  while ((match = html.exec(markdown)) !== null) {
    if (insideRanges(match.index, ignored)) continue;
    const url = match[2];
    const within = match[0].indexOf(url);
    const info = classify(url);
    refs.push({ syntax: "html", url, start: match.index + within, end: match.index + within + url.length, ...info });
  }

  const wiki = /!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  while ((match = wiki.exec(markdown)) !== null) {
    if (insideRanges(match.index, ignored)) continue;
    const url = match[1];
    const within = match[0].indexOf(url);
    refs.push({ syntax: "wikilink", url, start: match.index + within, end: match.index + within + url.length, remote: false });
  }

  refs.sort((a, b) => a.start - b.start);
  const remote = refs.filter((reference) => reference.remote);
  const local = refs.filter((reference) => !reference.remote);
  const hosts = [...new Set(remote.map((reference) => reference.host).filter((host): host is string => Boolean(host)))].sort();
  return { remote, local, hosts };
}

export function replaceRemoteUrls(markdown: string, replacements: Map<string, string>): string {
  const edits = scanImages(markdown).remote
    .filter((reference) => replacements.has(reference.url))
    .sort((a, b) => b.start - a.start);

  let output = markdown;
  for (const reference of edits) {
    const replacement = replacements.get(reference.url);
    if (replacement) output = output.slice(0, reference.start) + replacement + output.slice(reference.end);
  }
  return output;
}
