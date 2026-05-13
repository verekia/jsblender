import { fieldSize, parseFieldName } from './field.ts'

import type { BlendBlock, BlendHeader, FieldLayout, SDNA, SDNAField, SDNAStruct, SDNAStructLayout } from './types.ts'

const align4 = (n: number): number => (n + 3) & ~3

const decodeNullTerminatedList = (buf: Uint8Array, start: number, count: number): { items: string[]; end: number } => {
  const items: string[] = []
  let pos = start
  const decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    let end = pos
    while (end < buf.length && buf[end] !== 0) end++
    items.push(decoder.decode(buf.subarray(pos, end)))
    pos = end + 1
  }
  return { items, end: pos }
}

const buildLayout = (
  index: number,
  struct: SDNAStruct,
  types: string[],
  typeSizes: number[],
  parsedNames: ParsedFieldNameOrName,
  pointerSize: number,
): SDNAStructLayout => {
  const fields: FieldLayout[] = []
  const fieldByName = new Map<string, FieldLayout>()
  let offset = 0
  for (const f of struct.fields) {
    const name = parsedNames[f.nameIndex]
    if (!name) throw new Error(`SDNA struct ${types[struct.typeIndex]} references unknown name #${f.nameIndex}`)
    const typeName = types[f.typeIndex] ?? '<unknown>'
    const typeSize = typeSizes[f.typeIndex] ?? 0
    const size = fieldSize(name, typeSize, pointerSize)
    const layout: FieldLayout = { field: f, name, typeName, size, offset }
    fields.push(layout)
    fieldByName.set(name.baseName, layout)
    offset += size
  }
  return { index, typeName: types[struct.typeIndex] ?? '<unknown>', size: offset, fields, fieldByName }
}

type ParsedFieldNameOrName = ReturnType<typeof parseFieldName>[]

/**
 * Parses the DNA1 block payload into a fully resolved SDNA description.
 */
export const parseSDNA = (buf: Uint8Array, dna1: BlendBlock, header: BlendHeader): SDNA => {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const little = header.endianness === 'little'
  const base = dna1.dataOffset

  const readMagic = (offset: number, expected: string): void => {
    const got = String.fromCharCode(buf[offset] ?? 0, buf[offset + 1] ?? 0, buf[offset + 2] ?? 0, buf[offset + 3] ?? 0)
    if (got !== expected) throw new Error(`SDNA: expected ${expected} at +${offset - base}, got ${got}`)
  }

  readMagic(base, 'SDNA')
  readMagic(base + 4, 'NAME')
  const nameCount = view.getUint32(base + 8, little)
  const names = decodeNullTerminatedList(buf, base + 12, nameCount)

  let pos = align4(names.end - base) + base
  readMagic(pos, 'TYPE')
  const typeCount = view.getUint32(pos + 4, little)
  const typesList = decodeNullTerminatedList(buf, pos + 8, typeCount)

  pos = align4(typesList.end - base) + base
  readMagic(pos, 'TLEN')
  pos += 4
  const typeSizes: number[] = Array.from({ length: typeCount })
  for (let i = 0; i < typeCount; i++) {
    typeSizes[i] = view.getUint16(pos, little)
    pos += 2
  }
  pos = align4(pos - base) + base
  readMagic(pos, 'STRC')
  const structCount = view.getUint32(pos + 4, little)
  pos += 8

  const structs: SDNAStruct[] = Array.from({ length: structCount })
  for (let i = 0; i < structCount; i++) {
    const typeIndex = view.getUint16(pos, little)
    const fieldCount = view.getUint16(pos + 2, little)
    pos += 4
    const fields: SDNAField[] = Array.from({ length: fieldCount })
    for (let f = 0; f < fieldCount; f++) {
      const ti = view.getUint16(pos, little)
      const ni = view.getUint16(pos + 2, little)
      pos += 4
      fields[f] = { typeIndex: ti, nameIndex: ni }
    }
    structs[i] = { typeIndex, fields }
  }

  const parsedNames: ParsedFieldNameOrName = names.items.map(parseFieldName)
  const layouts = structs.map((s, i) => buildLayout(i, s, typesList.items, typeSizes, parsedNames, header.pointerSize))

  const structIndexByType = new Map<string, number>()
  for (const layout of layouts) structIndexByType.set(layout.typeName, layout.index)

  return {
    names: names.items,
    parsedNames,
    types: typesList.items,
    typeSizes,
    structs,
    layouts,
    structIndexByType,
  }
}
