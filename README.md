# WForYou

Panel de un grupo de amigos para World of Warcraft: Forever. Muestra el nivel, el equipo, el equipo objetivo y las profesiones de cada personaje, su progreso y dónde ir juntos, y envía avisos a Discord.

Todo funciona gratis con GitHub Actions y GitHub Pages; no hay servidor.

## Puesta en marcha

1. **Cliente de la API**: crea un cliente en el portal de desarrolladores de Battle.net (Battle.net Developer Portal) y acepta sus términos de uso.
2. **Secrets** del repositorio (*Settings → Secrets and variables → Actions*):
   - `BNET_CLIENT_ID` y `BNET_CLIENT_SECRET`
   - `DISCORD_WEBHOOK_URL` (opcional)
3. **Pages**: *Settings → Pages → Source: GitHub Actions*.
4. **Permisos**: *Settings → Actions → General → Workflow permissions → Read and write permissions*.
5. Pon los personajes en `config/personajes.json` y lanza **Actions → Sincronizar personajes → Run workflow**.

## La API de WoW: Forever

Blizzard no ha documentado todavía la API de Forever, pero funciona con estos namespaces: `profile-forever-{región}`, `static-forever-{región}` y `dynamic-forever-{región}`. Puede cambiar sin aviso.

- **No hay reinos**: cada personaje se identifica por **nombre y apellido**, únicos por región.
- **Un personaje solo aparece en la API a partir de nivel 10** y después de cerrar sesión al menos una vez. El retrato puede tardar horas más.
- **La API no da la especialización activa**: indícala en `config/personajes.json` con el campo `objetivo` (por ejemplo `warrior-protection`). Sirve para elegir la lista objetivo, mostrar la especialización y el rol.

```json
{ "personajes": [
  { "nombre": "Arrows", "apellido": "Skarchh", "objetivo": "warrior-protection" }
] }
```

Para ver qué responde la API en cada momento, lanza **Actions → Comprobar API de Forever** (opcionalmente con un nombre y apellido).

## Configuración

- `config/ajustes.json`: región, namespaces de la API, idioma y tipos de avisos, enlace al perfil y dirección de la web.
- `config/personajes.json`: personajes del grupo (solo el administrador puede cambiarlo).
- `config/objetivos/<clase>-<especialización>.json`: equipo objetivo por especialización, con IDs de objeto y, opcionalmente, dónde se consigue.

## Workflows

| Workflow | Cuándo | Qué hace |
|---|---|---|
| Sincronizar personajes | Cada hora, a mano o al cambiar la web/configuración | Descarga los datos, envía avisos y publica la web |
| Añadir amigo | A mano (solo administrador) | Añade un personaje (nombre, apellido y especialización) y lanza una sincronización |
| Resumen semanal | Domingos 19:00 UTC o a mano | Envía el resumen de la semana a Discord |
| Comprobar API de Forever | A mano | Comprueba qué responde la API de Forever y, si le das un personaje, qué datos se pueden leer |

## Uso de la API de Blizzard

Este proyecto sigue los [términos de uso de la API de Blizzard](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use):

- **Fuente de los datos**: la web y los avisos indican a Blizzard Entertainment como fuente, y aclaran que el proyecto no está afiliado ni respaldado por Blizzard. El nombre del proyecto no usa marcas de Blizzard.
- **Retención máxima de 30 días**: los datos se actualizan cada hora; el historial, los avisos y las fichas de objetos de más de 30 días se borran solos. Los datos no se guardan en `main`, sino en la rama `datos`, que se reescribe en cada sincronización con un único commit, sin historial.
- **Borrado a petición**: al quitar un personaje de `config/personajes.json`, todos sus datos se eliminan en la siguiente sincronización. Lo mismo ocurre si el personaje deja de existir.
- **Privacidad**: la política de privacidad está en `privacidad.html`.
- **Sin fines comerciales**: sin anuncios, pagos ni venta de datos.
- **Claves**: el `client_secret` solo vive en los secrets de GitHub y nunca llega a la web.
