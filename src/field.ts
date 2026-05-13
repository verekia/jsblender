import type { ParsedFieldName } from './types.ts'

/**
 * Parses a Blender SDNA field name like `*foo`, `(*bar)()`, or `baz[3][4]`
 * into its structural pieces.
 */
export const parseFieldName = (raw: string): ParsedFieldName => {
  let cursor = 0
  let pointerDepth = 0
  while (raw[cursor] === '*') {
    pointerDepth++
    cursor++
  }

  let isFunctionPointer = false
  if (raw[cursor] === '(') {
    // `(*name)()` form. After the closing paren, the rest is `()` argument list.
    isFunctionPointer = true
    cursor++
    while (raw[cursor] === '*') {
      pointerDepth++
      cursor++
    }
  }

  // Identifier runs until '[' or ')' or '('.
  let nameStart = cursor
  let nameEnd = cursor
  while (nameEnd < raw.length) {
    const ch = raw[nameEnd]
    if (ch === '[' || ch === ')' || ch === '(') break
    nameEnd++
  }
  const baseName = raw.slice(nameStart, nameEnd)

  const arrayDims: number[] = []
  let i = nameEnd
  while (i < raw.length) {
    if (raw[i] === '[') {
      const close = raw.indexOf(']', i)
      if (close < 0) break
      arrayDims.push(Number(raw.slice(i + 1, close)))
      i = close + 1
    } else {
      i++
    }
  }

  return { baseName, rawName: raw, pointerDepth: isFunctionPointer ? 1 : pointerDepth, isFunctionPointer, arrayDims }
}

/**
 * Returns the size in bytes of a parsed field given the pointer size used by
 * the file and the size of its base type.
 */
export const fieldSize = (parsed: ParsedFieldName, typeSize: number, pointerSize: number): number => {
  const elementSize = parsed.pointerDepth > 0 ? pointerSize : typeSize
  let total = elementSize
  for (const d of parsed.arrayDims) total *= d
  return total
}
