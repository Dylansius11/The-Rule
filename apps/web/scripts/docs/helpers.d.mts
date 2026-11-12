export const sections: string[][];
export function parseFrontmatter(
  source: string,
  file: string,
): { title: string; summary: string; agent: boolean; body: string };
export function parseName(name: string, file?: string): { order: number; slug: string };
export function plainText(text: string): string;
export function headings(body: string): { depth: number; text: string; id: string }[];
export function parseWords(source: string): string[];
export function bannedPhrases(text: string): string[];
