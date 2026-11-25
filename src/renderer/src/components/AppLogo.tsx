import logo from '../assets/buri-finance-logo.png'

// The Buri Finance app icon, sized like Astryx's NavIcon so it fits navigation headers.
// Decorative: it always sits beside the app name, which screen readers announce instead.
// Inline styles use Astryx token variables because the renderer has no StyleX compiler.
export function AppLogo(): React.JSX.Element {
  return (
    <img
      src={logo}
      alt=""
      draggable={false}
      style={{
        display: 'block',
        flexShrink: 0,
        width: 'var(--size-element-md)',
        height: 'var(--size-element-md)'
      }}
    />
  )
}
