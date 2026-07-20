import { describe, expect, it } from 'vitest'
import { createSourceSchema, runQuerySchema } from './data-source-ipc-schema'

describe('data source IPC schemas', () => {
  it('accepts bounded HTTPS Elasticsearch configuration', () => {
    expect(
      createSourceSchema.parse({
        type: 'elasticsearch',
        name: 'Research',
        endpoint: 'https://search.example.com',
      }),
    ).toMatchObject({ name: 'Research' })
  })

  it('rejects unsupported protocols, unknown fields and oversized secrets', () => {
    expect(() =>
      createSourceSchema.parse({ type: 'elasticsearch', name: 'x', endpoint: 'file:///tmp/db' }),
    ).toThrow()
    expect(() =>
      createSourceSchema.parse({
        type: 'elasticsearch',
        name: 'x',
        endpoint: 'https://user:password@example.com',
      }),
    ).toThrow()
    expect(() =>
      createSourceSchema.parse({
        type: 'elasticsearch',
        name: 'x',
        endpoint: 'https://example.com',
        unexpected: true,
      }),
    ).toThrow()
    expect(() =>
      createSourceSchema.parse({
        type: 'elasticsearch',
        name: 'x',
        endpoint: 'https://example.com',
        secret: { authType: 'bearer', token: 'x'.repeat(8_193) },
      }),
    ).toThrow()
  })

  it('rejects oversized query JSON and invalid row limits', () => {
    expect(() =>
      runQuerySchema.parse({ sourceId: 'source', query: { value: 'x'.repeat(1_048_576) } }),
    ).toThrow()
    expect(() => runQuerySchema.parse({ sourceId: 'source', query: {}, maxRows: 10_001 })).toThrow()
    expect(() =>
      runQuerySchema.parse({ sourceId: 'source', query: { score: Number.POSITIVE_INFINITY } }),
    ).toThrow()
  })
})
