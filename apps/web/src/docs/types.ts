export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

export interface DocEntry {
  slug: string;
  section: string;
  title: string;
  summary: string;
  order: number;
  path: string;
  headings: DocHeading[];
  plain: string;
}

export interface DocSection {
  id: string;
  title: string;
  entries: DocEntry[];
}

export interface DocsIndex {
  sections: DocSection[];
}

export interface Grammar {
  grammar: 'g1';
  forms: { id: number; name: string; minLiterals: number; maxLiterals: number }[];
  atoms: { id: number; english: string; negated: string; dsl: string }[];
  words: string[];
  number: { min: number; max: number };
  generatedFrom: string;
  fairLaws?: {
    total: number;
    byForm: Record<string, number>;
    byBucket: Record<string, number>;
    ruleCoreCommit: string;
  };
}
