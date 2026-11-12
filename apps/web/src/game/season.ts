export interface SeasonCursor {
  rounds_won: number;
  shares: number;
  earliest_winning_block: number | null;
  entity_tag: number;
  entity_id: number;
}
export interface SeasonRow extends SeasonCursor {
  earned: string;
  cursor: SeasonCursor;
}
export interface SeasonStatus {
  ready: boolean;
  total: number;
  indexed: number;
  revision: number;
}
export type SeasonBoard =
  | { supported: false }
  | { supported: true; ready: false; status: SeasonStatus }
  | { supported: true; ready: true; rows: SeasonRow[] };

export function nextSeasonCursor(rows: SeasonRow[], limit: number): SeasonCursor | null {
  return rows.length === limit ? rows[rows.length - 1]!.cursor : null;
}

/** Read every page from one index revision; never display a partially rebuilt or mixed board. */
export async function readSeasonPages(
  status: () => Promise<SeasonStatus>,
  page: (from: SeasonCursor | null, limit: number) => Promise<SeasonRow[]>,
): Promise<SeasonBoard> {
  const before = await status();
  if (!before.ready) return { supported: true, ready: false, status: before };
  const rows: SeasonRow[] = [];
  let from: SeasonCursor | null = null;
  do {
    const batch = await page(from, 200);
    rows.push(...batch);
    from = nextSeasonCursor(batch, 200);
  } while (from);
  const after = await status();
  if (!after.ready || after.revision !== before.revision)
    return { supported: true, ready: false, status: after };
  return { supported: true, ready: true, rows };
}
