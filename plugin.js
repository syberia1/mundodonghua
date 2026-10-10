// Mundo Donghua para Kino (apiVersion 6): catálogo de mundodonghua.com y reproducción por los
// servidores que usa la página (FileMoon, Voe, VidHide y StreamWish). Un solo módulo, sin
// dependencias. Corre en QuickJS: sin URL, atob, TextDecoder ni timers.

// ---------- 1. Constantes y textos ----------

const SITE = "https://www.mundodonghua.com";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const ID_OK = /^[A-Za-z0-9._~-]{1,128}$/;
const PAGE_SIZE = 60;

const TXT = {
  notFound: { es: "No encontramos esto en el sitio.", en: "We could not find this on the site." },
  siteDown: { es: "El sitio no responde ahora. Intenta más tarde.", en: "The site is not answering now. Try again later." },
  noServers: {
    es: "No se encontraron servidores de video para este capítulo.",
    en: "No video servers were found for this episode.",
  },
  serverFailed: {
    es: "No se pudo abrir el video en ese servidor. Prueba otro en el menú Servidor.",
    en: "The video could not be opened on that server. Try another one in the Servidor menu.",
  },
  badRef: { es: "Este título ya no es válido. Búscalo otra vez.", en: "This title is no longer valid. Search for it again." },
  episode: { es: "Capítulo ", en: "Episode " },
};

function lang() {
  return String(kino.lang || "es").toLowerCase().indexOf("en") === 0 ? "en" : "es";
}
function t(key) {
  return TXT[key][lang()];
}
function fail(code, detail, key) {
  return kino.error(code, detail, { userMessage: t(key) });
}

// ---------- 2. Utilidades de texto ----------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Base64 (normal o url-safe) a bytes; ignora "=", espacios y cualquier carácter ajeno.
function b64bytes(s) {
  const out = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c === "-") c = "+";
    else if (c === "_") c = "/";
    const v = B64.indexOf(c);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
      buf &= (1 << bits) - 1;
    }
  }
  return out;
}

function utf8(bytes) {
  let s = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      s += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    } else if (b >= 0xe0 && b < 0xf0) {
      const b2 = bytes[i++] & 63;
      const b3 = bytes[i++] & 63;
      s += String.fromCharCode(((b & 15) << 12) | (b2 << 6) | b3);
    } else if (b >= 0xf0) {
      const b2 = bytes[i++] & 63;
      const b3 = bytes[i++] & 63;
      const b4 = bytes[i++] & 63;
      const cp = (((b & 7) << 18) | (b2 << 12) | (b3 << 6) | b4) - 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}

function b64text(s) {
  return utf8(b64bytes(s));
}

function b64hex(s) {
  return b64bytes(s)
    .map((b) => (b < 16 ? "0" : "") + b.toString(16))
    .join("");
}

function b64std(s) {
  let x = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (x.length % 4) x += "=";
  return x;
}

function rot13(s) {
  return s.replace(/[A-Za-z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function unslash(s) {
  return String(s).replace(/\\\//g, "/").replace(/\\u0026/g, "&").replace(/&amp;/g, "&");
}

function cleanQuery(q) {
  return String(q || "")
    .replace(/[^\p{L}\p{N}\s'.:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(s) {
  let x = String(s || "").toLowerCase();
  if (x.normalize) x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return x.replace(/[^a-z0-9]+/g, " ").trim();
}

function abs(u, from) {
  if (!u) return "";
  u = String(u).trim();
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  const base = /^(https?:\/\/[^/?#]+)/i.exec(from || SITE);
  const origin = base ? base[1] : SITE;
  if (u[0] === "/") return origin + u;
  return origin + "/" + u;
}

function originOf(u) {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(String(u));
  return m ? m[1] : "";
}

function hostOf(u) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(u));
  return m ? m[1].toLowerCase() : "";
}

// Dean Edwards p.a.c.k.e.r: devuelve los textos desempaquetados de todos los bloques de `text`.
const PACKED_RE = /\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\(\s*'\|'\s*\)/g;
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function unbase(word, base) {
  let n = 0;
  for (let i = 0; i < word.length; i++) {
    const v = DIGITS.indexOf(word[i]);
    if (v < 0 || v >= base) return NaN;
    n = n * base + v;
  }
  return n;
}

function unpackAll(text) {
  const out = [];
  PACKED_RE.lastIndex = 0;
  let m;
  while ((m = PACKED_RE.exec(text)) && out.length < 8) {
    const payload = m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const base = parseInt(m[2], 10);
    const keys = m[4].replace(/\\'/g, "'").split("|");
    if (!(base >= 2 && base <= 62)) continue;
    out.push(
      payload.replace(/\b\w+\b/g, (w) => {
        const i = unbase(w, base);
        const r = Number.isNaN(i) ? "" : keys[i];
        return r ? r : w;
      })
    );
  }
  return out;
}

// ---------- 3. HTTP ----------

function isChallenge(status, body) {
  return status === 403 || status === 503 || /<title>\s*Just a moment|cf-browser-verification/i.test(body.slice(0, 4000));
}

// Páginas del sitio y de los embeds. Si el sitio responde con la comprobación del navegador
// (Cloudflare), se reintenta con una página oculta (solo para el propio sitio).
async function getPage(url, headers, embed) {
  let r = null;
  try {
    r = await kino.fetch(url, {
      headers: Object.assign(
        { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", Accept: "text/html,application/xhtml+xml,*/*" },
        headers || {}
      ),
    });
  } catch (e) {
    if (embed) throw e;
  }
  if (r && r.status === 404) throw fail("not_found", "HTTP 404 " + url, "notFound");
  if (r) {
    const body = r.text();
    if (r.ok && !isChallenge(r.status, body)) return { html: body, url: r.url || url };
    if (embed) throw fail("unavailable", "HTTP " + r.status + " " + url, "siteDown");
  }
  if (!embed && kino.browser && typeof kino.browser.page === "function") {
    try {
      const b = await kino.browser.page(url, { timeoutMs: 12000 });
      if (b && b.html) return { html: b.html, url: b.finalUrl || url };
    } catch (e) {
      kino.log("página oculta falló: " + (e && e.message));
    }
  }
  throw fail("unavailable", "no se pudo leer " + url, "siteDown");
}

// ---------- 4. Lectura de Mundo Donghua ----------

function mkItem(slug, title, poster, movie) {
  if (!slug || !ID_OK.test(slug) || !title) return null;
  const item = {
    id: slug,
    // Una película se reproduce de una vez: su ref va directo a resolve (capítulo 1 del sitio).
    ref: movie ? "e:" + slug + ":1" : "a:" + slug,
    title: String(title).slice(0, 200),
    kind: movie ? "movie" : "series",
  };
  if (poster) item.poster = poster;
  return item;
}

// El texto de una tarjeta viene como "Título Donghua Título 1,234": se queda con el título.
function titleFrom(text, img) {
  let title = img ? String(img.attrs.alt || img.attrs.title || "") : "";
  title = title.replace(/\s+/g, " ").trim();
  if (!title || /^(logo|donghua|mundo donghua)$/i.test(title)) {
    const m = /^(.+?)\s+(?:Donghua|Pel[ií]cula|OVA|Especial(?:es)?)\s*\1\b/i.exec(text);
    title = m ? m[1] : text.replace(/\s+[\d.,]+$/, "");
  }
  return title.replace(/\s*(Donghua|Pel[ií]cula|OVA|Especial)$/i, "").trim();
}

// Tarjetas de un listado: enlaces /donghua/<slug> con su carátula. opts.movies: todo es película.
function cardsFrom(html, opts) {
  opts = opts || {};
  const items = [];
  const seen = {};
  for (const a of kino.html.select(html, 'a[href*="/donghua/"]')) {
    const m = /\/donghua\/([A-Za-z0-9._~-]+)\/?(?:[?#].*)?$/.exec(a.attrs.href || "");
    if (!m || seen[m[1]]) continue;
    const text = a.text.replace(/\s+/g, " ").trim();
    const img = kino.html.select(a.html, "img")[0];
    const title = titleFrom(text, img);
    let poster = img ? abs(img.attrs["data-src"] || img.attrs.src || "") : "";
    if (/\/images\//.test(poster)) poster = "";
    const movie = !!opts.movies || /pel[ií]cula/i.test(text);
    const item = mkItem(m[1], title, poster, movie);
    if (!item) continue;
    seen[m[1]] = true;
    items.push(item);
  }
  return items;
}

const LISTS = {
  "list:emision": "/lista-donghuas-emision",
  "list:finalizados": "/lista-donghuas-finalizados",
  "list:recopilados": "/lista-donghuas-recopilados",
  "list:todas": "/lista-donghuas",
  "genre:pelicula": "/genero/" + encodeURIComponent("Película"),
};

async function listItems(ref) {
  const path = LISTS[ref];
  if (!path) throw fail("not_found", "lista " + ref, "notFound");
  const page = await getPage(SITE + path);
  return cardsFrom(page.html, { movies: ref === "genre:pelicula" });
}

// Corre fn sobre la lista con a lo más `limit` a la vez (Kino permite 6 fetches simultáneos).
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const k = next++;
      try {
        out[k] = await fn(list[k], k);
      } catch (e) {
        out[k] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

// ---------- TMDB: información e imágenes de capítulos ----------
// Kino pone la llave (kino.tmdb). Si TMDB falla o no encuentra la serie, todo sale igual, sin ese extra.

const TMDB_IMG = "https://image.tmdb.org/t/p/w300";
const TMDB_BACK = "https://image.tmdb.org/t/p/w780";
const NO_TMDB = /\b(ova|ovas|especial|especiales|recopilaci[oó]n|recopilado|movie|pel[ií]cula)\b/i;

function cacheGet(key) {
  try {
    return kino.storage.get(key);
  } catch (e) {
    return null;
  }
}
function cacheSet(key, value, ttlMs) {
  try {
    kino.storage.set(key, value, { ttlMs });
  } catch (e) {
    /* sin caché */
  }
}

// El número al final del título es la temporada del sitio ("Tales of Demons and Gods 10").
function splitTitle(title) {
  let season = 1;
  let base = String(title);
  let marked = false;
  let m = /\b(\d+)(?:st|nd|rd|th)\s+season\b/i.exec(base) || /\bseason\s+(\d+)\b/i.exec(base);
  if (m) {
    season = parseInt(m[1], 10);
    base = base.replace(m[0], " ");
    marked = true;
  } else {
    m = /^(.*\D)\s(\d{1,2})$/.exec(base);
    if (m) {
      season = parseInt(m[2], 10);
      base = m[1];
      marked = true;
    }
  }
  base = base.replace(/\(\d{4}\)/g, " ").replace(/\s+/g, " ").trim();
  return { base, season, marked };
}

function pickShow(results) {
  const list = (results || []).filter((r) => r && r.id);
  const anim = list.filter((r) => (r.genre_ids || []).indexOf(16) >= 0);
  const pool = anim.length ? anim : list;
  const cn = pool.filter((r) => (r.origin_country || []).indexOf("CN") >= 0);
  return (cn.length ? cn : pool)[0] || null;
}

async function tmdbSeason(id, season, language) {
  const d = await kino.tmdb("/tv/" + id + "/season/" + season, { language });
  return (d && d.episodes) || [];
}

// Un intento: serie por título, temporada dada. Devuelve { numero: datos } o {}.
async function tmdbTry(base, season, marked, maxNum) {
  if (base.length < 2) return {};
  const found = await kino.tmdb("/search/tv", { query: base, language: "es-MX", include_adult: false });
  const show = pickShow(found && found.results);
  if (!show) return {};
  const eps = await tmdbSeason(show.id, season, "es-MX");
  const byNum = {};
  if (!marked && maxNum > eps.length) {
    // Numeración absoluta (capítulo 527 de una serie sin temporadas en el sitio).
    const detail = await kino.tmdb("/tv/" + show.id, { language: "es-MX" });
    const seasons = ((detail && detail.seasons) || []).filter((x) => x.season_number > 0).slice(0, 12);
    let offset = 0;
    for (const se of seasons) {
      const list = se.season_number === season ? eps : await tmdbSeason(show.id, se.season_number, "es-MX");
      for (const e of list) byNum[offset + e.episode_number] = e;
      offset += list.length;
    }
  } else {
    for (const e of eps) byNum[e.episode_number] = e;
    const empty = eps.filter((e) => !e.overview).length;
    if (eps.length && empty > eps.length / 2) {
      try {
        const en = await tmdbSeason(show.id, season, "en-US");
        for (const e of en) if (byNum[e.episode_number] && !byNum[e.episode_number].overview) byNum[e.episode_number].overview = e.overview;
      } catch (err) {
        /* sin respaldo en inglés */
      }
    }
  }
  const out = {};
  for (const k of Object.keys(byNum)) {
    const e = byNum[k];
    out[k] = {
      name: String(e.name || "").slice(0, 200),
      overview: String(e.overview || "").slice(0, 2000),
      still: e.still_path ? TMDB_IMG + e.still_path : "",
      air: /^\d{4}-\d{2}-\d{2}$/.test(e.air_date || "") ? e.air_date : "",
      rt: e.runtime > 0 && e.runtime <= 1000 ? e.runtime : 0,
    };
  }
  return out;
}

async function tmdbEpisodes(title, maxNum) {
  const sp = splitTitle(title);
  const tries = [{ base: sp.base, season: sp.season, marked: sp.marked }];
  // Si el número final era parte del nombre y no una temporada, se busca el título completo.
  if (sp.marked) tries.push({ base: String(title).trim(), season: 1, marked: false });
  for (const tr of tries) {
    try {
      const out = await tmdbTry(tr.base, tr.season, tr.marked, maxNum);
      if (Object.keys(out).length) return out;
    } catch (e) {
      if (e && e.code === "rate_limited") throw e;
    }
  }
  return {};
}

async function episodeExtras(slug, title, maxNum) {
  if (typeof kino.tmdb !== "function" || NO_TMDB.test(title)) return {};
  const key = "tmdb1:" + slug;
  const hit = cacheGet(key);
  if (hit) {
    try {
      return JSON.parse(hit);
    } catch (e) {
      /* caché dañada */
    }
  }
  let extras = {};
  try {
    extras = await tmdbEpisodes(title, maxNum);
  } catch (e) {
    kino.log("tmdb: " + (e && e.message));
    return {};
  }
  const raw = JSON.stringify(extras);
  if (Object.keys(extras).length && raw.length < 60000) cacheSet(key, raw, 6 * 3600000);
  return extras;
}

// Fondo y resumen de cada título de una lista (películas y series).
async function movieInfo(title) {
  if (typeof kino.tmdb !== "function") return null;
  const plain = title.replace(/\bmovie\s*\d*\s*:?\s*/i, " ").replace(/\s+/g, " ").trim();
  const tries = plain && plain !== title ? [title, plain] : [title];
  for (const q of tries) {
    const r = await kino.tmdb("/search/movie", { query: q, language: "es-MX", include_adult: false });
    const hit = pickShow(r && r.results);
    if (hit) {
      return {
        overview: String(hit.overview || "").slice(0, 700),
        backdrop: hit.backdrop_path ? TMDB_BACK + hit.backdrop_path : "",
        year: String(hit.release_date || "").slice(0, 4),
      };
    }
  }
  return null;
}

async function seriesInfo(title) {
  if (typeof kino.tmdb !== "function") return null;
  const sp = splitTitle(title);
  const r = await kino.tmdb("/search/tv", { query: sp.base.length >= 2 ? sp.base : title, language: "es-MX", include_adult: false });
  const hit = pickShow(r && r.results);
  if (!hit) return null;
  return {
    overview: String(hit.overview || "").slice(0, 700),
    backdrop: hit.backdrop_path ? TMDB_BACK + hit.backdrop_path : "",
    year: "",
  };
}

// Con caché (una semana si hubo datos, un día si no). Lanza si TMDB falla: así no se guarda un "sin datos" falso.
async function infoFor(item) {
  const key = (item.kind === "movie" ? "mov1:" : "ser1:") + item.id;
  const hit = cacheGet(key);
  if (hit) return hit === "0" ? null : JSON.parse(hit);
  const info = item.kind === "movie" ? await movieInfo(item.title) : await seriesInfo(item.title);
  cacheSet(key, info ? JSON.stringify(info) : "0", info ? 7 * 86400000 : 86400000);
  return info;
}

function applyInfo(item, info) {
  if (!info) return;
  if (info.overview) item.overview = info.overview;
  if (info.backdrop) item.backdrop = info.backdrop;
  if (/^\d{4}$/.test(info.year || "")) item.year = info.year;
}

// Consulta TMDB como mucho `cap` veces nuevas por llamada (límite bajo por plugin); el resto sale de la caché.
async function enrichItems(items, cap) {
  let fresh = 0;
  const todo = [];
  for (const it of items) {
    if (NO_TMDB.test(it.title) && it.kind !== "movie") continue;
    const hit = cacheGet((it.kind === "movie" ? "mov1:" : "ser1:") + it.id);
    if (hit) applyInfo(it, hit === "0" ? null : JSON.parse(hit));
    else if (fresh < cap) {
      fresh++;
      todo.push(it);
    }
  }
  await mapLimit(todo, 4, async (it) => {
    try {
      applyInfo(it, await infoFor(it));
    } catch (e) {
      kino.log("sin datos de TMDB: " + (e && e.message));
    }
  });
}

// ---------- 5. search, home, browse ----------

export async function search(query) {
  const q = cleanQuery(query && query.q);
  if (q.length < 2) return [];
  let items = [];
  try {
    const page = await getPage(SITE + "/busquedas/" + encodeURIComponent(q));
    items = cardsFrom(page.html);
  } catch (e) {
    kino.log("busquedas falló: " + (e && e.message));
  }
  if (!items.length) {
    // Respaldo: se filtra el listado completo por título.
    const words = norm(q).split(" ").filter(Boolean);
    const all = await listItems("list:todas");
    items = all.filter((i) => {
      const nt = norm(i.title);
      return words.every((w) => nt.indexOf(w) >= 0);
    });
  }
  items = items.slice(0, 50);
  await enrichItems(items, 8);
  return items;
}

export async function home() {
  const en = lang() === "en";
  const defs = [
    { id: "en-emision", title: en ? "Airing now" : "En emisión", ref: "list:emision", genre: "anime", load: () => listItems("list:emision") },
    {
      id: "ultimos-agregados",
      title: en ? "Recently added" : "Últimos agregados",
      genre: "anime",
      load: async () => cardsFrom((await getPage(SITE + "/")).html),
    },
    { id: "peliculas", title: en ? "Movies" : "Películas", ref: "genre:pelicula", genre: "peliculas", load: () => listItems("genre:pelicula") },
    { id: "finalizadas", title: en ? "Completed" : "Finalizadas", ref: "list:finalizados", genre: "anime", load: () => listItems("list:finalizados") },
  ];
  const rows = await Promise.all(
    defs.map(async (d) => {
      try {
        const items = (await d.load()).slice(0, 40);
        if (!items.length) return null;
        await enrichItems(items, 8);
        const row = { id: d.id, title: d.title, items };
        if (d.ref) row.ref = d.ref;
        if (d.genre) row.genre = d.genre;
        return row;
      } catch (e) {
        kino.log("home: fila " + d.id + " falló: " + (e && e.message));
        return null;
      }
    })
  );
  return rows.filter(Boolean);
}

export async function browse(ref, cursor) {
  const all = await listItems(String(ref));
  const n = parseInt(cursor, 10);
  const from = n > 0 ? n : 0;
  const items = all.slice(from, from + PAGE_SIZE);
  await enrichItems(items, 10);
  const out = { items };
  if (from + PAGE_SIZE < all.length) out.next = String(from + PAGE_SIZE);
  return out;
}

// ---------- 6. episodes ----------

export async function episodes(ref) {
  const m = /^a:([A-Za-z0-9._~-]+)$/.exec(String(ref));
  if (!m) throw fail("not_found", "ref " + ref, "badRef");
  const slug = m[1];
  const page = await getPage(SITE + "/donghua/" + slug);
  const html = page.html;

  // Capítulos: enlaces /ver/<slug>/<n>.
  const nums = {};
  const re = new RegExp("/ver/" + slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(\\d{1,5})(?![\\d/])", "g");
  let x;
  while ((x = re.exec(html))) nums[parseInt(x[1], 10)] = true;
  const numbers = Object.keys(nums)
    .map(Number)
    .filter((n) => n >= 0 && n < 99999)
    .sort((a, b) => a - b)
    .slice(0, 2000);
  // Kino numera desde 1: si existe el capítulo 0, todos se muestran +1 (el título y el ref llevan el número real).
  const shift = numbers.length && numbers[0] === 0 ? 1 : 0;

  // Datos de la serie.
  const info = {};
  const h1 = kino.html.select(html, "h1")[0];
  if (h1 && h1.text.trim()) info.title = h1.text.replace(/\s+/g, " ").trim().slice(0, 200);
  const og = kino.html.select(html, "meta[property=og:description]")[0];
  if (og && og.attrs.content && og.attrs.content.trim().length > 10) info.overview = og.attrs.content.replace(/\s+/g, " ").trim().slice(0, 2000);
  const poster = kino.html.select(html, "meta[property=og:image]")[0];
  if (poster && poster.attrs.content) info.poster = abs(poster.attrs.content);
  const bg = kino.html.select(html, 'img[src*="/bg_"]')[0];
  if (bg && bg.attrs.src) info.backdrop = abs(bg.attrs.src);
  const genres = [];
  for (const g of kino.html.select(html, 'a[href*="/genero/"]')) {
    const name = g.text.replace(/\s+/g, " ").trim();
    if (name && name.length <= 30 && genres.indexOf(name) < 0) genres.push(name);
  }
  if (genres.length && genres.length <= 12) info.genres = genres.slice(0, 5);
  // Título, resumen, imagen, fecha y duración de cada capítulo (TMDB), con el número real del sitio.
  const extras = await episodeExtras(slug, info.title || slug.replace(/-/g, " "), numbers.length ? numbers[numbers.length - 1] : 0);
  const list = numbers.map((n) => {
    const ep = { season: 1, number: n + shift, ref: "e:" + slug + ":" + n, title: t("episode") + n };
    const x = extras[n];
    if (x) {
      if (x.name && !/^(episode|episodio|cap[ií]tulo)\s*\d+$/i.test(x.name)) ep.title = x.name;
      if (x.overview) ep.overview = x.overview;
      if (x.still) ep.still = x.still;
      if (x.air) ep.airDate = x.air;
      if (x.rt) ep.runtimeMinutes = x.rt;
    }
    return ep;
  });
  // Si el sitio no trae sinopsis o fondo, se completan con TMDB.
  if (!info.overview || !info.backdrop) {
    try {
      const extra = await infoFor({ id: slug, kind: "series", title: info.title || slug.replace(/-/g, " ") });
      if (extra) {
        if (!info.backdrop && extra.backdrop) info.backdrop = extra.backdrop;
        if (!info.overview && extra.overview) info.overview = extra.overview;
      }
    } catch (e) {
      kino.log("ficha sin TMDB: " + (e && e.message));
    }
  }
  return { series: info, episodes: list };
}

// ---------- 7. Servidores ----------

const KIND_LABEL = { voe: "Voe", filemoon: "FileMoon", vidhide: "VidHide", streamwish: "StreamWish" };

// Qué servidor es: por el nombre de la pestaña ("Fm", "Voe", "Vh", "Sw") o, si no, por el dominio.
function classify(url, hint) {
  const h = String(hint || "").toLowerCase().trim();
  if (/^voe/.test(h)) return "voe";
  if (/^(fm|file\s*moon)/.test(h)) return "filemoon";
  if (/^(vh|vid\s*hide|file\s*lions)/.test(h)) return "vidhide";
  if (/^(sw|stream\s*wish)/.test(h)) return "streamwish";
  const host = hostOf(url);
  if (/voe/.test(host)) return "voe";
  if (/moon|byse/.test(host)) return "filemoon";
  if (/vidhide|lions|hide/.test(host)) return "vidhide";
  if (/wish|swi|swdyu/.test(host)) return "streamwish";
  return "other";
}

const SKIP_HOST = /mundodonghua|patreon|facebook|youtube|youtu\.be|google|gstatic|cloudflare|twitter|instagram|jquery|bootstrap|fonts\.|cdnjs|jsdelivr|unpkg|histats|disqus|w3\.org|schema\.org/i;
const STATIC_EXT = /\.(?:css|js|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|xml)(?:[?#]|$)/i;

function urlsIn(text) {
  const flat = unslash(text);
  const out = [];
  const re = /https?:\/\/[^\s"'<>\\)]+/g;
  let m;
  while ((m = re.exec(flat))) out.push(m[0].replace(/[),;.]+$/, ""));
  return out;
}

function looksEmbed(u) {
  return /\/(?:e|embed|v|d|f|play|player)\/[A-Za-z0-9_-]+/i.test(u) || classify(u, "") !== "other";
}

// Busca en un HTML (y en los scripts empaquetados que lleve) embeds externos y direcciones del propio sitio
// que a su vez cargan el reproductor.
function collect(html, pageUrl) {
  const texts = [html].concat(unpackAll(html));
  const embeds = [];
  const local = [];
  const addEmbed = (u) => {
    u = abs(u, pageUrl);
    if (!/^https?:\/\//.test(u) || STATIC_EXT.test(u) || embeds.indexOf(u) >= 0) return;
    if (hostOf(u).indexOf("mundodonghua.com") >= 0) {
      if (local.indexOf(u) < 0) local.push(u);
    } else if (!SKIP_HOST.test(hostOf(u)) && looksEmbed(u)) embeds.push(u);
  };
  for (const text of texts) {
    for (const u of urlsIn(text)) addEmbed(u);
    // Rutas del propio sitio que cargan el reproductor.
    const re = /["'](\/?[A-Za-z0-9_\-/.]*(?:protea|player|embed|stream)[A-Za-z0-9_\-/.]*\.php\?[^"'\s<>]+|\/?[A-Za-z0-9_\-/.]*protea[^"'\s<>]*)["']/gi;
    let m;
    while ((m = re.exec(unslash(text)))) {
      const u = abs(m[1], pageUrl);
      if (!STATIC_EXT.test(u) && local.indexOf(u) < 0) local.push(u);
    }
    // Direcciones guardadas en base64.
    const b64 = text.match(/[A-Za-z0-9+/_-]{28,}={0,2}/g) || [];
    for (const tok of b64.slice(0, 40)) {
      const dec = b64text(tok);
      if (/^https?:\/\/[^\s]+$/.test(dec)) addEmbed(dec);
    }
  }
  for (const f of kino.html.select(html, "iframe")) {
    const src = f.attrs.src || f.attrs["data-src"] || "";
    if (src) addEmbed(src);
  }
  return { embeds, local };
}

function tabLabels(html) {
  const out = [];
  const sel = 'ul.nav a, [data-toggle="tab"], [data-bs-toggle="tab"], [role="tab"], .nav-tabs a, .tabs a, .nav-pills a';
  for (const a of kino.html.select(html, sel)) {
    const label = a.text.replace(/\bADS\b/i, "").replace(/\s+/g, " ").trim();
    if (label && label.length <= 20 && out.indexOf(label) < 0) out.push(label);
  }
  return out;
}

// Servidores de un capítulo, en el orden de las pestañas del sitio.
async function discover(html, pageUrl) {
  const first = collect(html, pageUrl);
  let embeds = first.embeds.slice();
  const local = first.local.filter((u) => u !== pageUrl).slice(0, 6);
  const pages = await mapLimit(local, 3, async (u) => (await getPage(u, { Referer: pageUrl })).html);
  for (const h of pages) {
    if (!h) continue;
    for (const u of collect(h, pageUrl).embeds) if (embeds.indexOf(u) < 0) embeds.push(u);
  }
  const labels = tabLabels(html);
  return embeds.map((url, i) => ({ url, hint: labels.length === embeds.length ? labels[i] : "" }));
}

// --- Medios dentro de un texto ---

function mediaIn(text) {
  const flat = unslash(text);
  const hls = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i.exec(flat);
  const mp4 = /https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/i.exec(flat);
  return { hls: hls ? hls[0] : "", mp4: mp4 ? mp4[0] : "" };
}

// --- Voe ---

// Voe esconde el JSON del video en <script type="application/json">["..."]</script>:
// ROT13, quitar marcas, base64, restar 3 a cada carácter, invertir, base64, JSON.
function decodeVoe(enc) {
  let s = rot13(enc);
  s = s.replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g, "");
  s = b64text(s);
  let shifted = "";
  for (let i = 0; i < s.length; i++) shifted += String.fromCharCode(s.charCodeAt(i) - 3);
  shifted = shifted.split("").reverse().join("");
  return JSON.parse(b64text(shifted));
}

function pickUrls(obj) {
  const get = (k) => (typeof obj[k] === "string" ? obj[k] : "");
  const hls = get("source") || get("hls") || get("file");
  const mp4 = get("direct_access_url") || get("mp4");
  return { hls: /\.m3u8/i.test(hls) ? hls : "", mp4: mp4 || (hls && !/\.m3u8/i.test(hls) ? hls : "") };
}

function voeExtract(html) {
  const re = /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      let raw = JSON.parse(m[1].trim());
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw !== "string") continue;
      const found = pickUrls(decodeVoe(raw));
      if (found.hls || found.mp4) return found;
    } catch (e) {
      /* siguiente script */
    }
  }
  const val = (key) => {
    const x = new RegExp("[\"']" + key + "[\"']\\s*:\\s*[\"']([^\"']+)[\"']").exec(html);
    if (!x) return "";
    const v = unslash(x[1]);
    return /^https?:\/\//i.test(v) ? v : b64text(v);
  };
  const old = { hls: val("hls"), mp4: val("mp4") };
  if (/^https?:\/\//i.test(old.hls) || /^https?:\/\//i.test(old.mp4)) {
    return { hls: /^https?:\/\//i.test(old.hls) ? old.hls : "", mp4: /^https?:\/\//i.test(old.mp4) ? old.mp4 : "" };
  }
  return mediaIn(html);
}

async function voeStream(embed) {
  let url = embed;
  let html = "";
  for (let hop = 0; hop < 3; hop++) {
    const page = await getPage(url, { Referer: SITE + "/" }, true);
    html = page.html;
    url = page.url;
    const jm = /window\.location\.href\s*=\s*["']([^"']+)["']/.exec(html);
    if (jm && /^https?:\/\//i.test(jm[1]) && jm[1] !== url) {
      url = jm[1];
      continue;
    }
    break;
  }
  const found = voeExtract(html);
  const main = found.hls || found.mp4;
  if (!main) throw fail("unavailable", "Voe sin video en " + url, "serverFailed");
  const headers = { Referer: originOf(url) + "/", "User-Agent": UA };
  const res = { url: main, headers, alts: [] };
  if (found.hls && found.mp4) res.alts.push({ url: found.mp4, headers, label: "Voe MP4" });
  return res;
}

// --- StreamWish, VidHide y FileMoon clásico (JW Player empaquetado) ---

async function jwStream(embed) {
  const page = await getPage(embed, { Referer: SITE + "/" }, true);
  const texts = [page.html].concat(unpackAll(page.html));
  let url = "";
  for (const text of texts) {
    const flat = unslash(text);
    let m = /["']hls\d*["']\s*:\s*["']([^"']+)["']/.exec(flat);
    if (m) url = abs(m[1], page.url);
    if (!url) {
      m = /file\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(flat);
      if (m) url = abs(m[1], page.url);
    }
    if (!url) {
      m = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i.exec(flat);
      if (m) url = abs(m[1], page.url);
    }
    if (!url) {
      const media = mediaIn(flat);
      url = media.hls || media.mp4;
    }
    if (url) break;
  }
  if (!url) throw fail("unavailable", "sin video en " + hostOf(page.url), "serverFailed");
  return { url, headers: { Referer: originOf(page.url) + "/", "User-Agent": UA }, alts: [] };
}

// --- FileMoon actual (la lista de reproducción llega cifrada con AES-GCM) ---

async function byseStream(embed) {
  const m = /^(https?:\/\/[^/]+)\/(?:e|d|embed|v)\/([A-Za-z0-9]+)/.exec(embed);
  if (!m) throw fail("unavailable", "dirección no válida", "serverFailed");
  const r = await kino.fetch(m[1] + "/api/videos/" + m[2] + "/embed/playback", {
    headers: { "User-Agent": UA, Referer: embed, Accept: "application/json" },
  });
  if (!r.ok) throw fail("unavailable", "playback HTTP " + r.status, "serverFailed");
  const pb = (r.json() || {}).playback;
  if (!pb || !pb.iv || !pb.payload || !Array.isArray(pb.key_parts)) throw fail("unavailable", "playback sin datos", "serverFailed");
  const plain = kino.crypto.decrypt("aes-256-gcm", {
    key: pb.key_parts.map(b64hex).join(""),
    keyEncoding: "hex",
    iv: b64hex(pb.iv),
    ivEncoding: "hex",
    data: b64std(pb.payload),
    inputEncoding: "base64",
    outputEncoding: "utf8",
  });
  const media = mediaIn(plain);
  const url = media.hls || media.mp4;
  if (!url) throw fail("unavailable", "playback sin video", "serverFailed");
  return { url, headers: { Referer: originOf(embed) + "/", "User-Agent": UA }, alts: [] };
}

// --- Último recurso: abrir el embed en una página oculta y leer el video que pide ---

async function captureStream(embed) {
  if (!kino.browser || typeof kino.browser.capture !== "function") return null;
  try {
    const r = await kino.browser.capture(embed, { headers: { Referer: SITE + "/" }, timeoutMs: 15000 });
    const media = r && r.media && r.media[0];
    if (media && media.url) return { url: media.url, headers: media.headers || {}, alts: [] };
  } catch (e) {
    kino.log("captura falló: " + (e && e.message));
  }
  return null;
}

async function streamFor(s) {
  const attempts = s.kind === "voe" ? [voeStream] : s.kind === "filemoon" ? [jwStream, byseStream] : [jwStream];
  let last = null;
  for (const fn of attempts) {
    try {
      return await fn(s.url);
    } catch (e) {
      last = e;
      kino.log(s.kind + ": " + (e && e.message));
    }
  }
  const cap = await captureStream(s.url);
  if (cap) return cap;
  throw last || fail("unavailable", "servidor sin video", "serverFailed");
}

// ---------- 8. resolve ----------

function serverLabel(s, all) {
  const base = KIND_LABEL[s.kind] || "Servidor";
  const same = all.filter((x) => KIND_LABEL[x.kind] === KIND_LABEL[s.kind] || (!KIND_LABEL[x.kind] && !KIND_LABEL[s.kind]));
  return same.length > 1 ? base + " " + (same.indexOf(s) + 1) : base;
}

// "e:<slug>:<n>" = el capítulo; "s:<índice>:e:<slug>:<n>" = copia diferida de un servidor.
function parseRef(ref) {
  let m = /^s:(\d+):e:([A-Za-z0-9._~-]+):(\d+)$/.exec(ref);
  if (m) return { idx: parseInt(m[1], 10), slug: m[2], n: parseInt(m[3], 10) };
  m = /^e:([A-Za-z0-9._~-]+):(\d+)$/.exec(ref);
  if (m) return { idx: -1, slug: m[1], n: parseInt(m[2], 10) };
  return null;
}

export async function resolve(ref) {
  const p = parseRef(String(ref));
  if (!p) throw fail("not_found", "ref " + ref, "badRef");

  const pageUrl = SITE + "/ver/" + p.slug + "/" + p.n;
  const page = await getPage(pageUrl);
  const found = await discover(page.html, page.url);
  const all = found.map((s, i) => ({ url: s.url, kind: classify(s.url, s.hint), i }));

  if (!all.length) {
    // Sin servidores a la vista: se deja que una página oculta reproduzca el capítulo y se lee su video.
    const cap = await captureStream(pageUrl);
    if (cap) return { url: cap.url, headers: cap.headers, label: "Mundo Donghua", expiresInSeconds: 1800 };
    throw fail("not_found", "sin servidores", "noServers");
  }

  let order;
  if (p.idx >= 0) {
    order = all[p.idx] ? [all[p.idx]] : [];
  } else {
    const pref = String(kino.config.get("server") || "voe");
    order = all.slice().sort((a, b) => (a.kind === pref ? 0 : 1) - (b.kind === pref ? 0 : 1));
  }

  let main = null;
  let used = null;
  const rest = [];
  let tries = 0;
  for (const s of order) {
    if (main || tries >= 3) {
      rest.push(s);
      continue;
    }
    tries++;
    try {
      main = await streamFor(s);
      used = s;
    } catch (e) {
      kino.log("resolve: " + s.kind + " falló: " + (e && e.message));
    }
  }
  if (!main) throw fail("unavailable", "ningún servidor abrió", "serverFailed");

  const stream = {
    url: main.url,
    headers: main.headers,
    label: serverLabel(used, all),
    expiresInSeconds: 1800,
  };
  if (p.idx < 0) {
    const alts = main.alts.slice();
    for (const s of rest) {
      alts.push({ label: serverLabel(s, all), ref: "s:" + s.i + ":e:" + p.slug + ":" + p.n });
    }
    if (alts.length) stream.alternatives = alts.slice(0, 8);
  }
  return stream;
}
