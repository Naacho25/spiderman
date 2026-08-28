# Deploy a Vercel

Proyecto estático, sin build step. Framework preset: **Other**.
Build command: (vacío). Output directory: (vacío / raíz).

## Qué subir al repo
- `index.html` (entry point, Vercel lo sirve en `/`)
- `src/` (todos los `.js`, ES modules)
- `vendor/three/` (Three.js r169 vendorizado — es una dependencia real de producción, no un artefacto de build)

## Qué NO hace falta subir
- `serve.ps1` — servidor local de prueba, ya está en `.gitignore`
- `index-2d-legacy-backup.html` — backup viejo de la versión 2D, no lo usa el juego actual. Queda a criterio tuyo si lo conservás en el repo o lo borrás a mano; no lo tocamos acá.
- `spiderman_v2.0.2.html` — mismo caso, es un archivo suelto de una versión anterior, no lo referencia `index.html`. Decidilo vos.

## Rutas relativas
Ya verificado: el importmap de `index.html` mapea `"three"` a `./vendor/three/build/three.module.js` (ruta relativa), y todos los imports en `src/*.js` y en `vendor/three/examples/jsm/` usan rutas relativas correctas. No necesita ajustes para servirse desde la raíz de Vercel.

## Tamaño
`vendor/three/` pesa ~1.4 MB (11 archivos). Es lo más pesado del primer `git push`, pero está lejos de cualquier límite de Vercel/GitHub.
