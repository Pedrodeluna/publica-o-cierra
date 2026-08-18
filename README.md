# Publica o cierra

Extensión de Chrome. Cuenta 15 minutos desde que abres X. Si en ese rato no
publicas ni comentas, te tapa el timeline. Cualquier publicación reinicia el reloj.

## Instalar

1. Descomprime la carpeta donde quieras dejarla (si la mueves después, hay que volver a cargarla).
2. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → elige la carpeta `publica-o-cierra`.
4. **Recarga las pestañas de X que ya tuvieras abiertas.** Los content scripts solo
   entran en pestañas cargadas después de instalar.

Funciona en Chrome, Edge, Brave y Arc. En Firefox haría falta portar el manifest.

## Qué cuenta como publicar

Un tuit, una respuesta a otro (comentario) y una cita: las tres cosas pasan por la
misma operación de X, `CreateTweet`, así que las tres reinician el reloj.

El retuit va por otra operación y **no cuenta por defecto**, porque retuitear es
scrollear con pasos extra. Se puede activar desde el popup.

Solo se reinicia si X confirma que la publicación salió: si el envío falla, el reloj sigue.

## Cómo se comporta el reloj

- **Solo corre con X delante**: pestaña visible y ventana con el foco. Una pestaña
  de X olvidada de fondo no gasta minutos.
- **Se para si te ausentas**: a los 2 minutos sin tocar el ordenador se pausa, y
  sigue donde estaba cuando vuelves. Nada de avisos al volver del café.
- **Es global**: cuatro pestañas de X comparten un único reloj.
- El icono de la extensión muestra los minutos que quedan; el contador flotante
  abajo a la derecha, los segundos.

## Cuando salta el aviso

Se difumina todo y quedan tres salidas:

- **Escribir algo** → abre el compositor y te da 2 minutos de margen. Si no publicas,
  el aviso vuelve.
- **5 minutos más** → snooze.
- **Salir de X** → cierra la pestaña (si el navegador no deja cerrarla por script,
  la deja en blanco).

Todos los tiempos se cambian desde el popup del icono.

## Cuando deje de funcionar

X cambia su frontend a menudo. Esto está enganchado a los nombres de operación de
GraphQL (`CreateTweet`), que son mucho más estables que los `data-testid` del DOM,
pero no son eternos.

Para comprobarlo: abre DevTools en X, pestaña **Network**, filtra por `graphql` y
publica algo. Si la petición ya no se llama `CreateTweet`, cambia el array `OPS`
en `src/interceptor.js` por el nombre nuevo.

Si el aviso no salta nunca, mira la consola del service worker desde
`chrome://extensions` → *Service worker* de esta extensión.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/interceptor.js` | Parchea `fetch`/XHR en el contexto de X para detectar publicaciones |
| `src/content.js` | Presencia de la pestaña + contador, aviso y confirmación (shadow DOM) |
| `src/background.js` | El reloj: `chrome.alarms` + deadline absoluto, pausas, badge |
| `src/popup.html/js` | Estado y ajustes |

## Privacidad

No sale nada del navegador. No hay servidor, no se usa la API de X (que desde
febrero de 2026 es de pago por uso) y no se lee el contenido de lo que publicas:
solo si la petición salió bien.
