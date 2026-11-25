import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { KeptItem } from './filters'

/**
 * Local tech daily database (`userData/techdaily/techdaily.sqlite`, never synced).
 * Replaces Argus' Elasticsearch: one row per normalised URL, idempotent upsert.
 * Lead (event) tables arrive with the AI extraction step (spec §6.2–6.3).
 */
export class TechDailyStore {
  private readonly db: DatabaseSync

  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;')
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS articles (
          url_key TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          published_day TEXT,
          domain TEXT NOT NULL,
          lang TEXT NOT NULL,
          queries TEXT NOT NULL,
          engines TEXT NOT NULL,
          provider TEXT NOT NULL,
          first_seen TEXT NOT NULL,
          last_seen TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS articles_last_seen ON articles(last_seen);
        CREATE TABLE IF NOT EXISTS search_calls (
          day TEXT NOT NULL, provider TEXT NOT NULL, calls INTEGER NOT NULL,
          PRIMARY KEY (day, provider)
        );
      `)
      this.db.prepare("INSERT OR IGNORE INTO meta VALUES ('schema', '1')").run()
      if (path !== ':memory:') chmodSync(path, 0o600)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Upsert articles seen on `day`. Seen again: only last_seen, queries, engines and a missing
   * date change; first_seen and the first domain stay (Argus L2 semantics).
   */
  upsertArticles(
    items: KeptItem[],
    provider: string,
    day: string,
  ): { inserted: number; updated: number } {
    const select = this.db.prepare(
      'SELECT queries, engines, published_day FROM articles WHERE url_key=?',
    )
    const insert = this.db.prepare(
      `INSERT INTO articles (url_key, url, normalized_url, title, content, published_day, domain,
        lang, queries, engines, provider, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const update = this.db.prepare(
      'UPDATE articles SET last_seen=?, queries=?, engines=?, published_day=? WHERE url_key=?',
    )
    return this.transaction(() => {
      let inserted = 0
      let updated = 0
      for (const item of items) {
        const row = select.get(item.key) as
          | { queries: string; engines: string; published_day: string | null }
          | undefined
        if (!row) {
          insert.run(
            item.key,
            item.url,
            item.normalizedUrl,
            item.title,
            item.content,
            item.date,
            item.domain,
            item.lang,
            JSON.stringify(item.queries),
            JSON.stringify(item.engines),
            provider,
            day,
            day,
          )
          inserted++
          continue
        }
        const queries = [...new Set([...(JSON.parse(row.queries) as string[]), ...item.queries])]
        const engines = [...new Set([...(JSON.parse(row.engines) as string[]), ...item.engines])]
        update.run(
          day,
          JSON.stringify(queries.slice(0, 50)),
          JSON.stringify(engines),
          row.published_day ?? item.date,
          item.key,
        )
        updated++
      }
      return { inserted, updated }
    })
  }

  /** Drop articles not seen for `keepDays` days. */
  prune(beforeDay: string): number {
    return Number(
      this.db.prepare('DELETE FROM articles WHERE last_seen < ?').run(beforeDay).changes,
    )
  }

  callsOn(day: string, provider: string): number {
    const row = this.db
      .prepare('SELECT calls FROM search_calls WHERE day=? AND provider=?')
      .get(day, provider) as { calls: number } | undefined
    return row ? Number(row.calls) : 0
  }

  addCall(day: string, provider: string): void {
    this.db
      .prepare(
        `INSERT INTO search_calls (day, provider, calls) VALUES (?, ?, 1)
         ON CONFLICT(day, provider) DO UPDATE SET calls = calls + 1`,
      )
      .run(day, provider)
  }

  articleCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM articles').get() as { n: number }).n)
  }

  close(): void {
    this.db.close()
  }
}
