/**
 * Tiny matrix math used to compose Blender object world matrices.
 *
 * Conventions:
 * - All 4x4 matrices are column-major Float32Array(16), matching Blender's
 *   internal `float mat[4][4]` layout. mat[0..3] = first column, mat[12..14] =
 *   translation.
 * - All 3x3 matrices are column-major number[9].
 * - All rotations use the right-hand rule (Blender's convention).
 */

export type Mat4 = Float32Array
export type Mat3 = number[]
export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]

export const mat4Identity = (): Mat4 => {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

/** out = a * b (column-major: applies b first to a column vector, then a). */
export const mat4Multiply = (a: Mat4, b: Mat4): Mat4 => {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
      out[col * 4 + row] = s
    }
  }
  return out
}

/** Transform a 3D point by a column-major 4x4 (treating it as homogeneous w=1). */
export const mat4TransformPoint = (m: Mat4, v: Vec3): Vec3 => {
  const x = v[0]
  const y = v[1]
  const z = v[2]
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ]
}

/** Transform a direction vector (no translation, no normalisation). */
export const mat4TransformDirection = (m: Mat4, v: Vec3): Vec3 => {
  const x = v[0]
  const y = v[1]
  const z = v[2]
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z,
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z,
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z,
  ]
}

/** General 4x4 inverse (cofactor expansion). Returns identity if singular. */
export const mat4Invert = (m: Mat4): Mat4 => {
  const a00 = m[0] ?? 0,
    a01 = m[1] ?? 0,
    a02 = m[2] ?? 0,
    a03 = m[3] ?? 0
  const a10 = m[4] ?? 0,
    a11 = m[5] ?? 0,
    a12 = m[6] ?? 0,
    a13 = m[7] ?? 0
  const a20 = m[8] ?? 0,
    a21 = m[9] ?? 0,
    a22 = m[10] ?? 0,
    a23 = m[11] ?? 0
  const a30 = m[12] ?? 0,
    a31 = m[13] ?? 0,
    a32 = m[14] ?? 0,
    a33 = m[15] ?? 0

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (det === 0) return mat4Identity()
  const inv = 1 / det

  const out = new Float32Array(16)
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv
  return out
}

/**
 * Blender stores quaternions in `w, x, y, z` order. Returns a column-major
 * 3x3 rotation matrix.
 */
const quatToMat3 = (q: Vec4): Mat3 => {
  const w = q[0]
  const x = q[1]
  const y = q[2]
  const z = q[3]
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z
  return [
    1 - 2 * (yy + zz),
    2 * (xy + wz),
    2 * (xz - wy),
    2 * (xy - wz),
    1 - 2 * (xx + zz),
    2 * (yz + wx),
    2 * (xz + wy),
    2 * (yz - wx),
    1 - 2 * (xx + yy),
  ]
}

// Blender rotation orders: 1=XYZ … 6=ZYX. Index 0 = X axis, 1 = Y, 2 = Z.
const EULER_AXES: Record<number, [number, number, number]> = {
  1: [0, 1, 2],
  2: [0, 2, 1],
  3: [1, 0, 2],
  4: [1, 2, 0],
  5: [2, 0, 1],
  6: [2, 1, 0],
}

const axisRotation = (axis: number, angle: number): Mat3 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  if (axis === 0) return [1, 0, 0, 0, c, s, 0, -s, c]
  if (axis === 1) return [c, 0, -s, 0, 1, 0, s, 0, c]
  return [c, s, 0, -s, c, 0, 0, 0, 1]
}

const mat3Multiply = (a: Mat3, b: Mat3): Mat3 => {
  const out: Mat3 = Array.from({ length: 9 }, () => 0)
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      out[col * 3 + row] =
        (a[row] ?? 0) * (b[col * 3] ?? 0) +
        (a[3 + row] ?? 0) * (b[col * 3 + 1] ?? 0) +
        (a[6 + row] ?? 0) * (b[col * 3 + 2] ?? 0)
    }
  }
  return out
}

/**
 * Builds a column-major rotation matrix from a Blender Euler angle triple. The
 * angles are applied in the order specified by `mode`:
 *
 *   mode = 1 (XYZ) → first X, then Y, then Z. Combined matrix is Rz * Ry * Rx.
 *
 * For other modes the axis order is permuted, but the same "first axis
 * innermost" rule applies.
 */
const eulerToMat3 = (eul: Vec3, mode: number): Mat3 => {
  const order = EULER_AXES[mode] ?? EULER_AXES[1]!
  const r0 = axisRotation(order[0]!, eul[order[0]!] ?? 0)
  const r1 = axisRotation(order[1]!, eul[order[1]!] ?? 0)
  const r2 = axisRotation(order[2]!, eul[order[2]!] ?? 0)
  return mat3Multiply(r2, mat3Multiply(r1, r0))
}

/**
 * Axis-angle (mode = -1): `rotAxis` is the axis, `rotAngle` the angle.
 * Returns a column-major 3x3 rotation matrix.
 */
const axisAngleToMat3 = (axis: Vec3, angle: number): Mat3 => {
  const len = Math.hypot(axis[0], axis[1], axis[2])
  if (len === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const x = axis[0] / len
  const y = axis[1] / len
  const z = axis[2] / len
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    c + x * x * t,
    y * x * t + z * s,
    z * x * t - y * s,
    x * y * t - z * s,
    c + y * y * t,
    z * y * t + x * s,
    x * z * t + y * s,
    y * z * t - x * s,
    c + z * z * t,
  ]
}

export interface ObjectTransformInputs {
  loc: Vec3
  rot: Vec3
  quat: Vec4
  rotAxis: Vec3
  rotAngle: number
  size: Vec3
  /**
   * Blender's `rotmode`:
   *   0 = quaternion
   *   1..6 = Euler (XYZ, XZY, YXZ, YZX, ZXY, ZYX)
   *  -1 = axis-angle
   */
  rotmode: number
}

/**
 * Composes a local-to-parent transform matrix from a Blender object's stored
 * loc/rot/size + rotmode. Mirrors `loc_eulO_size_to_mat4` /
 * `loc_quat_size_to_mat4` / `loc_axisangle_size_to_mat4` from Blender's source.
 */
export const composeObjectMatrix = (t: ObjectTransformInputs): Mat4 => {
  let r: Mat3
  if (t.rotmode === 0) r = quatToMat3(t.quat)
  else if (t.rotmode === -1) r = axisAngleToMat3(t.rotAxis, t.rotAngle)
  else r = eulerToMat3(t.rot, t.rotmode > 0 && t.rotmode <= 6 ? t.rotmode : 1)

  const m = new Float32Array(16)
  m[0] = (r[0] ?? 0) * t.size[0]
  m[1] = (r[1] ?? 0) * t.size[0]
  m[2] = (r[2] ?? 0) * t.size[0]
  m[4] = (r[3] ?? 0) * t.size[1]
  m[5] = (r[4] ?? 0) * t.size[1]
  m[6] = (r[5] ?? 0) * t.size[1]
  m[8] = (r[6] ?? 0) * t.size[2]
  m[9] = (r[7] ?? 0) * t.size[2]
  m[10] = (r[8] ?? 0) * t.size[2]
  m[12] = t.loc[0]
  m[13] = t.loc[1]
  m[14] = t.loc[2]
  m[15] = 1
  return m
}

/** Returns the upper-left 3x3 of a 4x4 (column-major). */
export const mat4ToMat3 = (m: Mat4): Mat3 => [
  m[0] ?? 0,
  m[1] ?? 0,
  m[2] ?? 0,
  m[4] ?? 0,
  m[5] ?? 0,
  m[6] ?? 0,
  m[8] ?? 0,
  m[9] ?? 0,
  m[10] ?? 0,
]

/** Transposes a column-major 3x3. */
export const mat3Transpose = (m: Mat3): Mat3 => [
  m[0] ?? 0,
  m[3] ?? 0,
  m[6] ?? 0,
  m[1] ?? 0,
  m[4] ?? 0,
  m[7] ?? 0,
  m[2] ?? 0,
  m[5] ?? 0,
  m[8] ?? 0,
]

/** Inverts a column-major 3x3 (cofactor / det). Returns identity if singular. */
export const mat3Invert = (m: Mat3): Mat3 => {
  const a = m[0] ?? 0,
    b = m[1] ?? 0,
    c = m[2] ?? 0
  const d = m[3] ?? 0,
    e = m[4] ?? 0,
    f = m[5] ?? 0
  const g = m[6] ?? 0,
    h = m[7] ?? 0,
    i = m[8] ?? 0
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (det === 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inv = 1 / det
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ]
}

/** Applies a column-major 3x3 to a Vec3. */
export const mat3TransformDirection = (m: Mat3, v: Vec3): Vec3 => [
  (m[0] ?? 0) * v[0] + (m[3] ?? 0) * v[1] + (m[6] ?? 0) * v[2],
  (m[1] ?? 0) * v[0] + (m[4] ?? 0) * v[1] + (m[7] ?? 0) * v[2],
  (m[2] ?? 0) * v[0] + (m[5] ?? 0) * v[1] + (m[8] ?? 0) * v[2],
]
