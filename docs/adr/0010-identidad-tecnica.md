# ADR-0010: Recursos técnicos de identidad

## Estado

Aceptado para el cierre correctivo de la Fase 0.

## Decisión

VICAM puede incluir favicon, logotipo tipográfico, iconos PWA, iconos maskable,
apple-touch-icon, iconografía Lucide y recursos técnicos del mapa. La identidad
base usa el primario `#0075DE` y una `V` blanca simple.

La autorización no permite fotografías, imágenes decorativas, avatares,
cargas de imágenes por usuarios ni almacenamiento offline de archivos. No
modifica las decisiones D-01 a D-80.

## Consecuencias

Los recursos se generan desde un SVG determinista, se versionan con la PWA y se
validan mediante pruebas de manifest, formato y dimensiones.
