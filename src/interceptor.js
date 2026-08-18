/**
 * Corre en el mundo MAIN (mismo contexto que el JS de X) y en document_start,
 * antes de que el bundle de X guarde su propia referencia a fetch.
 *
 * X manda todo por GraphQL. El hash de la URL cambia en cada deploy, pero el
 * nombre de la operación no:
 *   .../i/api/graphql/<hash>/CreateTweet    -> tuit, respuesta (comentario) y cita
 *   .../i/api/graphql/<hash>/CreateRetweet  -> retuit
 *
 * Publicar y comentar comparten CreateTweet, así que los dos cuentan.
 */
(() => {
  const TAG = 'PUBLICA_O_CIERRA';
  const OPS = ['CreateTweet', 'CreateRetweet'];

  const opFor = (url) => {
    if (typeof url !== 'string') return null;
    return OPS.find((op) => url.includes('/' + op)) || null;
  };

  const emit = (op) => {
    try {
      window.postMessage({ [TAG]: true, type: 'publish', op }, window.location.origin);
    } catch (_) {}
  };

  // 200 no siempre significa publicado: GraphQL devuelve errores con status 200.
  const confirm = (res, op) => {
    if (!res || !res.ok) return;
    try {
      res
        .clone()
        .json()
        .then((body) => {
          const failed = body && Array.isArray(body.errors) && body.errors.length > 0;
          if (!failed) emit(op);
        })
        .catch(() => emit(op));
    } catch (_) {
      emit(op);
    }
  };

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) {}
      const op = opFor(url);
      const promise = nativeFetch.apply(this, arguments);
      if (!op) return promise;
      return promise.then((res) => {
        confirm(res, op);
        return res;
      });
    };
  }

  // Red de seguridad por si alguna ruta sigue usando XHR.
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__pocOp = opFor(url);
    } catch (_) {}
    return nativeOpen.apply(this, arguments);
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__pocOp) {
      this.addEventListener('load', () => {
        if (this.status >= 200 && this.status < 300) emit(this.__pocOp);
      });
    }
    return nativeSend.apply(this, arguments);
  };
})();
