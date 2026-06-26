/**
 * Skeleton del portal mientras se hidrata el estado desde sessionStorage.
 * Imita la forma del stepper + la tarjeta del paso para que la espera se lea como
 * "cargando contenido" y no como una pantalla vacía. Decorativo: aria-hidden en
 * las barras, role="status" en el contenedor para anunciar la carga.
 */
const STEPS = [0, 1, 2, 3]

export function SkeletonPortal(): React.ReactElement {
  return (
    <div role="status" aria-label="Cargando" aria-busy="true">
      {/* Stepper skeleton */}
      <div className="stepper" aria-hidden="true">
        {STEPS.map((i) => (
          <div className="step" key={i}>
            <div className="step-inner">
              <div className="skeleton" style={{ width: 27, height: 27, borderRadius: '50%' }} />
              <div className="skeleton" style={{ width: 56, height: 11, borderRadius: 4 }} />
            </div>
            {i < STEPS.length - 1 && (
              <div className="skeleton" style={{ width: 26, height: 2, borderRadius: 2 }} />
            )}
          </div>
        ))}
      </div>

      {/* Card skeleton */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '40px 20px 72px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 520 }} aria-hidden="true">
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1.5px solid var(--border-light)',
              borderRadius: 18,
              padding: '24px 24px 28px',
            }}
          >
            {/* Título + subtítulo */}
            <div className="skeleton" style={{ width: '55%', height: 18, marginBottom: 10 }} />
            <div className="skeleton" style={{ width: '38%', height: 12, marginBottom: 24 }} />

            {/* Filas de contenido */}
            <div className="skeleton" style={{ width: '100%', height: 46, borderRadius: 12, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: '100%', height: 46, borderRadius: 12, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: '100%', height: 46, borderRadius: 12, marginBottom: 24 }} />

            {/* Botón */}
            <div className="skeleton" style={{ width: '100%', height: 52, borderRadius: 13 }} />
          </div>
        </div>
      </main>
    </div>
  )
}
