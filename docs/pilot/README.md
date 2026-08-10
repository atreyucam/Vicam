# Piloto operativo VICAM

Esta plantilla registra el piloto de una semana definido por D-45 y D-80. No
autoriza produccion ni sustituye la aprobacion de release.

## Preparacion

- Release candidato:
- Ambiente y URL de staging:
- Periodo:
- Manager participante:
- Supervisor participante:
- Responsable tecnico:
- Responsable de backup:
- Proceso anterior disponible y verificado:
- Datos ficticios o anonimizados confirmados:

## Escenarios obligatorios

| Escenario                                       | Responsable          | Evidencia | Resultado |
| ----------------------------------------------- | -------------------- | --------- | --------- |
| Login y recuperacion de sesion                  | Manager / Supervisor |           | Pendiente |
| Cuenta, contacto, visita, cierre y tarea online | Manager / Supervisor |           | Pendiente |
| Flujo offline, reconexion y conflicto           | Manager / Supervisor |           | Pendiente |
| Reasignacion y retiro de datos locales          | Manager              |           | Pendiente |
| Documento limpio, rechazo y descarga autorizada | Manager / Supervisor |           | Pendiente |
| Importacion repetida sin duplicados             | Manager              |           | Pendiente |
| Reportes PDF y XLSX con mismo alcance           | Manager              |           | Pendiente |
| Backup, restore, rollback y smoke               | Responsable tecnico  |           | Pendiente |

## Registro diario

Cada hallazgo debe indicar fecha, escenario, severidad, responsable, estado y
fecha objetivo. No se aceptan secretos, datos personales reales ni contenido
documental en esta evidencia.

| Fecha | Hallazgo | Severidad | Responsable | Estado | Fecha objetivo |
| ----- | -------- | --------- | ----------- | ------ | -------------- |
|       |          |           |             |        |                |

## Puerta de salida

- [ ] No existen defectos bloqueantes o criticos.
- [ ] Permisos y ownership fueron validados.
- [ ] Sync no perdio ni duplico operaciones.
- [ ] Restore y rollback tienen evidencia.
- [ ] Los participantes completaron los escenarios.
- [ ] El proceso anterior permanecio disponible.
- [ ] Riesgos no bloqueantes tienen responsable y fecha.

## Decision formal

- Resultado: `APROBAR`, `EXTENDER` o `RECHAZAR`.
- Manager:
- Supervisor:
- Responsable tecnico:
- Fecha:
- Observaciones:
