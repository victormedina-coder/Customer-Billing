import type { NextConfig } from "next";

// Política de seguridad de contenido (CSP).
//
// Decisiones de diseño:
//   - style-src 'unsafe-inline': el portal usa estilos inline y next/font
//     que inyectan estilos en el <head> sin nonce. Endurecer a nonce-based
//     CSP es trabajo futuro — requiere pasar el nonce de middleware a
//     cada componente servidor.
//   - script-src 'unsafe-inline': baseline pragmático. Next.js App Router
//     inyecta scripts inline de hidratación. Migrar a nonces es el paso
//     siguiente una vez se tenga el middleware de nonce.
//   - img-src data: blob:: las descargas de PDF y los logos del portal usan
//     data URIs y blob URLs generados en el cliente.
//   - connect-src 'self': el front solo llama a sus propias rutas /api/*.
//     Si en el futuro se integran SDKs externos (analytics, Hotjar, etc.)
//     habrá que agregar sus dominios aquí.
//   - frame-ancestors 'none': equivalente a X-Frame-Options: DENY pero en CSP.
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "object-src 'none'",
]

const securityHeaders = [
  {
    // Fuerza HTTPS por 2 años en el dominio y subdominios.
    // Solo tiene efecto en Railway (HTTPS); en dev se ignora al no haber TLS.
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    // Evita que el navegador "adivine" el MIME type de la respuesta.
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Prohíbe que el portal sea embebido en iframes (anti-clickjacking).
    // Redundante con frame-ancestors de la CSP, pero se mantiene para
    // navegadores que no soportan CSP level 2.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Envía el origen completo solo en peticiones same-origin;
    // a cross-origin solo envía el origen sin path ni query.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Deshabilita features del navegador que el portal no usa.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  {
    // CSP construida desde el array de directivas para facilitar lectura y mantenimiento.
    key: 'Content-Security-Policy',
    value: cspDirectives.join('; '),
  },
]

const nextConfig: NextConfig = {
  // Permite que el HMR del dev server acepte peticiones desde la red local
  // (p.ej. probar el responsive en el celular vía la IP LAN). Solo afecta
  // a `next dev`; en producción no tiene efecto. El comodín cubre la subred
  // para no romperse cuando el DHCP cambie la IP del equipo.
  allowedDevOrigins: ['192.168.100.*'],

  async headers() {
    return [
      {
        // Aplica las cabeceras de seguridad a todas las rutas del portal.
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
};

export default nextConfig;
