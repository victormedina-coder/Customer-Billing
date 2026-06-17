export function LoadingSpinner({ size = 17 }: { size?: number }) {
  return (
    <span
      style={{
        width: size, height: size,
        border: '2.5px solid rgba(255,255,255,0.4)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'spin 0.7s linear infinite',
      }}
    />
  )
}
