export type BlenderIconType =
  | 'scene'
  | 'collection'
  | 'object'
  | 'mesh'
  | 'material'
  | 'light'
  | 'camera'
  | 'image'
  | 'armature'

/**
 * Approximations of Blender's outliner ID-type icons, tinted with the same
 * canonical colours Blender uses in its default theme. These are hand-built
 * SVGs, not the literal Blender icon set (which is GPL-licensed and not
 * trivially embeddable as an inline glyph) — they're close enough to read at
 * a glance.
 */
const ICON_COLOR: Record<BlenderIconType, string> = {
  scene: '#bbbbbb',
  collection: '#facd55',
  object: '#ed9b40',
  mesh: '#a3d977',
  material: '#e26d65',
  light: '#ffce5e',
  camera: '#a4b4c6',
  image: '#9abccc',
  armature: '#9fb6da',
}

const PATHS: Record<BlenderIconType, React.ReactNode> = {
  scene: (
    <>
      <rect x="1.5" y="3" width="13" height="9" rx="1" fill="currentColor" />
      <rect x="2.75" y="4.25" width="10.5" height="6.5" fill="#0b0d10" />
      <rect x="5" y="12.5" width="6" height="1.5" rx="0.5" fill="currentColor" />
    </>
  ),
  collection: (
    <path
      d="M2 5.2A1.2 1.2 0 0 1 3.2 4h2.5l1.4 1.6h5.7A1.2 1.2 0 0 1 14 6.8v5.4A1.2 1.2 0 0 1 12.8 13.4H3.2A1.2 1.2 0 0 1 2 12.2V5.2z"
      fill="currentColor"
    />
  ),
  object: (
    <>
      <path
        d="M8 1.5 14 5v6L8 14.5 2 11V5L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 8 14 5M8 8 2 5M8 8v6.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </>
  ),
  mesh: (
    <>
      <path d="M8 2 14 13 2 13z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none" />
      <circle cx="8" cy="2" r="1.6" fill="currentColor" />
      <circle cx="14" cy="13" r="1.6" fill="currentColor" />
      <circle cx="2" cy="13" r="1.6" fill="currentColor" />
    </>
  ),
  material: (
    <>
      <circle cx="8" cy="8" r="6" fill="currentColor" />
      <ellipse cx="6" cy="6" rx="2" ry="1.6" fill="#ffffff" opacity="0.55" />
    </>
  ),
  light: (
    <>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="8" y1="0.75" x2="8" y2="3" />
        <line x1="8" y1="13" x2="8" y2="15.25" />
        <line x1="0.75" y1="8" x2="3" y2="8" />
        <line x1="13" y1="8" x2="15.25" y2="8" />
        <line x1="2.8" y1="2.8" x2="4.4" y2="4.4" />
        <line x1="11.6" y1="11.6" x2="13.2" y2="13.2" />
        <line x1="2.8" y1="13.2" x2="4.4" y2="11.6" />
        <line x1="11.6" y1="4.4" x2="13.2" y2="2.8" />
      </g>
    </>
  ),
  camera: (
    <>
      <path d="M2.5 5.25h2L5.5 3.5h5l1 1.75h2v8h-11z" fill="currentColor" />
      <circle cx="8" cy="9.25" r="2.75" fill="#0b0d10" />
      <circle cx="8" cy="9.25" r="1.1" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="1.5" y="3" width="13" height="10" rx="1" fill="currentColor" />
      <path d="M3 12 6.5 8.5 9 11l2.5-3.2L13 12z" fill="#0b0d10" />
      <circle cx="11.25" cy="6" r="1.1" fill="#0b0d10" />
    </>
  ),
  armature: (
    <>
      <path d="M5.4 5.4 10.6 10.6m0-5.2L5.4 10.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="4.2" cy="4.2" r="2.1" fill="currentColor" />
      <circle cx="11.8" cy="11.8" r="2.1" fill="currentColor" />
    </>
  ),
}

interface BlenderIconProps {
  type: BlenderIconType
  size?: number
  className?: string
}

const BlenderIcon = ({ type, size = 16, className }: BlenderIconProps) => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    className={`inline-block shrink-0 align-middle ${className ?? ''}`}
    style={{ color: ICON_COLOR[type] }}
    aria-hidden
  >
    {PATHS[type]}
  </svg>
)

export default BlenderIcon
