import { describe, expect, it } from 'vitest'
import {
  parseAltiumPcbDoc,
  serializeAltiumPcbDocToBinary,
  serializeAltiumSchDocToBinary,
} from 'altiumts'
import { parseAltiumPreview } from './altium-preview-parser'
import { fsIpcContracts } from '../../shared/ipc/fs-contract'

const schematic =
  '|HEADER=Protel for Windows - Schematic Capture Ascii File Version 5.0\n|RECORD=31|SHEETSTYLE=0\n|RECORD=27|LOCATIONCOUNT=2|X1=100|Y1=100|X2=200|Y2=100\n|RECORD=4|LOCATION.X=100|LOCATION.Y=120|TEXT=<script>alert(1)</script>'
const pcb =
  '|RECORD=Board|FILENAME=PCB 5.0 Binary File|VERSION=5.00|KIND0=0|VX0=0mil|VY0=0mil|KIND1=0|VX1=1000mil|VY1=0mil|KIND2=0|VX2=1000mil|VY2=1000mil|KIND3=0|VX3=0mil|VY3=1000mil\n|RECORD=Track|LAYER=TOP|X1=100mil|Y1=100mil|X2=200mil|Y2=100mil|WIDTH=10mil\n|RECORD=Track|LAYER=BOTTOM|X1=100mil|Y1=200mil|X2=200mil|Y2=200mil|WIDTH=10mil'

describe('local read-only Altium conversion', () => {
  it('renders binary schematic wires and escaped source labels without changing bytes', () => {
    const bytes = serializeAltiumSchDocToBinary(schematic)
    const before = bytes.slice()
    const result = parseAltiumPreview({
      bytes,
      fileName: 'sample.SchDoc',
      path: '/workspace/sample.SchDoc',
    })
    expect(bytes).toEqual(before)
    expect(result.kind).toBe('altium-drawing')
    if (result.kind !== 'altium-drawing') throw new Error('expected drawing')
    expect(result.counts).toContainEqual({ label: '导线', value: 1 })
    const svg = Buffer.from(result.content, 'base64').toString()
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
  })

  it('reads binary PCB tracks and renders distinct, validated layers', () => {
    const bytes = serializeAltiumPcbDocToBinary(parseAltiumPcbDoc(pcb))
    const job = { bytes, fileName: 'board.PcbDoc', path: '/workspace/board.PcbDoc' }
    const top = parseAltiumPreview({ ...job, options: { altiumLayer: 'TOP' } })
    const bottom = parseAltiumPreview({ ...job, options: { altiumLayer: 'BOTTOM' } })
    expect(top.kind).toBe('altium-drawing')
    if (top.kind !== 'altium-drawing' || bottom.kind !== 'altium-drawing')
      throw new Error('expected drawing')
    expect(top.layers).toEqual(['BOTTOM', 'TOP'])
    expect(top.counts).toContainEqual({ label: '走线', value: 2 })
    expect(top.selectedLayer).toBe('TOP')
    expect(top.content).not.toBe(bottom.content)
    expect(() => parseAltiumPreview({ ...job, options: { altiumLayer: 'MISSING' } })).toThrow(
      '不存在',
    )
  })

  it('reports project references without reading any referenced files', () => {
    const result = parseAltiumPreview({
      bytes: Buffer.from(
        '[Design]\nVersion=1.0\n[Document1]\nDocumentPath=sub\\power.SchDoc\n[Document2]\nDocumentPath=../../outside.PcbDoc',
      ),
      fileName: 'x.PrjPcb',
      path: '/workspace/x.PrjPcb',
    })
    expect(result).toEqual({
      kind: 'project-references',
      references: ['sub\\power.SchDoc', '../../outside.PcbDoc'],
    })
  })

  it('merges equivalent PCB layer names in the selector', () => {
    const result = parseAltiumPreview({
      bytes: Buffer.from(
        pcb +
          '\n|RECORD=Track|LAYER=Mid-Layer 2|X1=100mil|Y1=100mil|X2=200mil|Y2=100mil|WIDTH=10mil' +
          '\n|RECORD=Track|LAYER=MID2|X1=100mil|Y1=200mil|X2=200mil|Y2=200mil|WIDTH=10mil' +
          '\n|RECORD=Track|LAYER=PLANE1|X1=100mil|Y1=300mil|X2=200mil|Y2=300mil|WIDTH=10mil' +
          '\n|RECORD=Track|LAYER=INTERNALPLANE1|X1=100mil|Y1=400mil|X2=200mil|Y2=400mil|WIDTH=10mil',
      ),
      fileName: 'board.PcbDoc',
      path: '/board.PcbDoc',
      options: { altiumLayer: 'MID2' },
    })
    if (result.kind !== 'altium-drawing') throw new Error('expected drawing')
    expect(result.layers).toEqual(['BOTTOM', 'INTERNALPLANE1', 'MID2', 'TOP'])
    const svg = Buffer.from(result.content, 'base64').toString()
    expect(svg.match(/data-record="Track"/g)).toHaveLength(2)
  })

  it('renders projected linear dimensions in source units instead of literal TEXTFORMAT', () => {
    const bytes = serializeAltiumPcbDocToBinary(
      parseAltiumPcbDoc(
        pcb +
          '\n|RECORD=Dimension|DIMENSIONKIND=1|LAYER=TOPOVERLAY|REFERENCES_COUNT=2' +
          '|REFERENCE0POINTX=100mil|REFERENCE0POINTY=100mil' +
          '|REFERENCE1POINTX=1100mil|REFERENCE1POINTY=300mil|X1=100mil|Y1=400mil' +
          '|TEXTFORMAT=10mil|TEXTDIMENSIONUNIT=Millimeters|TEXTPRECISION=2|TEXTSUFFIX= mm',
      ),
    )
    const before = bytes.slice()
    const result = parseAltiumPreview({ bytes, fileName: 'board.PcbDoc', path: '/board.PcbDoc' })
    expect(bytes).toEqual(before)
    if (result.kind !== 'altium-drawing') throw new Error('expected drawing')
    const svg = Buffer.from(result.content, 'base64').toString()
    expect(svg).toContain('25.40 mm')
    expect(svg).not.toContain('10mil</text>')
  })

  it('rejects corrupt, mismatched and oversized source data instead of showing a blank success', () => {
    expect(() =>
      parseAltiumPreview({ bytes: Buffer.from('not altium'), fileName: 'x.SchDoc', path: '/x' }),
    ).toThrow()
    expect(() =>
      parseAltiumPreview({
        bytes: serializeAltiumSchDocToBinary(schematic).slice(0, 700),
        fileName: 'x.SchDoc',
        path: '/x',
      }),
    ).toThrow()
    expect(() =>
      parseAltiumPreview({
        bytes: serializeAltiumSchDocToBinary(schematic),
        fileName: 'x.PcbDoc',
        path: '/x',
      }),
    ).toThrow('不匹配')
    expect(() =>
      parseAltiumPreview({
        bytes: new Uint8Array(32 * 1024 * 1024 + 1),
        fileName: 'x.PcbDoc',
        path: '/x',
      }),
    ).toThrow('32 MB')
  })

  it('accepts the existing one-argument IPC and rejects unbounded or undeclared render options', () => {
    expect(fsIpcContracts.renderFile.parseArgs(['/x'])).toEqual(['/x', undefined])
    expect(fsIpcContracts.renderFile.parseArgs(['/x', { altiumLayer: 'TOP' }])).toEqual([
      '/x',
      { altiumLayer: 'TOP' },
    ])
    for (const options of [
      { altiumLayer: 'x'.repeat(129) },
      { altiumLayer: '../x' },
      { write: true },
    ]) {
      expect(() => fsIpcContracts.renderFile.parseArgs(['/x', options])).toThrow()
    }
  })
})
