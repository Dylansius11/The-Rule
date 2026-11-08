/** The agent-facing files the docs pipeline publishes next to the pages. */
export const CONTEXT_PATH = '/CONTEXT.md';
export const LLMS_PATH = '/llms.txt';
export const GRAMMAR_PATH = '/grammar.json';

/**
 * Fetch a generated static file as text. The dev server answers a missing file with the app shell (HTML, 200),
 * so an HTML reply is treated as "not found" rather than shown as the document.
 */
export async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${path}: not found`);
  return res.text();
}

/** Copy text to the clipboard. False when the browser refuses, so the caller can say so. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path (older browsers, insecure origins, denied permission) */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Fetch `/CONTEXT.md` and copy it. Used by the landing band; the docs chunk loads on demand. */
export async function copyAgentContext(): Promise<boolean> {
  return copyText(await fetchText(CONTEXT_PATH));
}
