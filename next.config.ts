import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite que el HMR del dev server acepte peticiones desde la red local
  // (p.ej. probar el responsive en el celular vía la IP LAN). Solo afecta
  // a `next dev`; en producción no tiene efecto. El comodín cubre la subred
  // para no romperse cuando el DHCP cambie la IP del equipo.
  allowedDevOrigins: ['192.168.100.*'],
};

export default nextConfig;
