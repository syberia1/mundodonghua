# Mundo Donghua para Kino

Plugin de Kino (apiVersion 6) para [Mundo Donghua](https://www.mundodonghua.com): busca donghua subtitulado, muestra su catálogo y reproduce por los servidores que usa la página: **FileMoon, Voe, VidHide y StreamWish**. También permite descargar.

## Qué hace

| Función | Fuente |
| --- | --- |
| Inicio | Filas En emisión, Últimos agregados, Películas y Finalizadas |
| Ver más | Listados `/lista-donghuas-*` y `/genero/Película`, paginados de 60 en 60 |
| Búsqueda | `/busquedas/<texto>`; si no responde, filtra `/lista-donghuas` por título |
| Ficha | `/donghua/<slug>`: carátula, fondo, sinopsis, géneros y capítulos |
| Película | Se muestra como película (un solo botón) y abre `/ver/<slug>/1` |
| Reproducir | `/ver/<slug>/<n>` y los servidores que cargue |

Si una serie tiene capítulo 0, todos los números se muestran +1 (Kino numera desde 1); el título y el enlace llevan el número real.

## Cómo encuentra el video

El sitio carga cada servidor desde su propio script, y desde fuera no se puede ver cómo. Por eso el plugin lo descubre en la propia página y va de lo más directo a lo más general:

1. Busca embeds en el HTML del capítulo: iframes, enlaces, scripts empaquetados (p.a.c.k.e.r) y direcciones en base64.
2. Si el capítulo apunta a rutas del propio sitio que cargan el reproductor, las lee también (hasta 6).
3. Clasifica cada embed por el nombre de la pestaña (Fm, Voe, Vh, Sw) o por su dominio.
4. Extrae el video según el servidor:
   - **Voe:** JSON ofuscado de la página (mismo método que el plugin de TioAnime).
   - **StreamWish y VidHide:** reproductor JW empaquetado.
   - **FileMoon:** reproductor empaquetado y, si no, la lista cifrada (AES-GCM) de su API.
5. Si un servidor no se deja leer, abre su página en un navegador oculto y toma el video que pide (por eso el manifiesto declara `"browser": "pages"`).
6. Reproduce el servidor preferido y deja los demás en el menú **Servidor**.

## Instalación

1. Cambia `author` en `kino-plugin.json`.
2. Sube `kino-plugin.json` y `plugin.js` a la raíz de un repositorio público de GitHub.
3. En Kino: **Ajustes ▸ Plugins** y escribe `tu-usuario/tu-repo`.

Permisos que Kino mostrará: conectarse a cualquier host (los servidores de video cambian de dominio), abrir páginas ocultas para encontrar el video y descargar.

## Si algo falla

Enciende **Modo debug** en la pestaña del plugin y revisa el registro. Dónde tocar:

| Síntoma | Dónde |
| --- | --- |
| Filas o listados vacíos | `cardsFrom()` (enlaces `/donghua/<slug>`) |
| Sin capítulos | `episodes()` (enlaces `/ver/<slug>/<n>`) |
| "No se encontraron servidores" | `collect()` y `discover()`: el sitio cambió cómo carga los reproductores |
| Un servidor no abre | `voeExtract()`, `jwStream()`, `byseStream()` |
| Sitio responde 403 | Cloudflare; se reintenta con página oculta en `getPage()` |

## Aviso

El plugin no aloja videos: solo lee el sitio y sus servidores. Úsalo con contenido al que tengas derecho.
