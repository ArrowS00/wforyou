import { TEXTOS, RANURAS, ORDEN_RANURAS } from "./i18n.js";

// ---------- Estado ----------
const estado = {
  idioma: document.documentElement.lang === "en" ? "en" : "es",
  datos: null,      // datos/personajes.json
  historial: [],    // datos/historial.json
  avisos: [],       // datos/avisos.json
  ajustes: null,    // config/ajustes.json
  objetos: {},      // datos/objetos.json (fichas para el tooltip)
  seleccionado: null,
  metrica: "nivel",
  ocultos: new Set(),
};

const admin = (() => {
  const p = new URLSearchParams(location.search);
  try {
    if (p.get("admin") === "0") localStorage.removeItem("wfy-admin");
    else if (p.has("admin")) localStorage.setItem("wfy-admin", "1");
    return localStorage.getItem("wfy-admin") === "1";
  } catch { return p.has("admin"); }
})();

// Repo de GitHub deducido de la URL de GitHub Pages (usuario.github.io/repo)
const repo = (() => {
  const usuario = location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] : null;
  const nombre = location.pathname.split("/").filter(Boolean)[0];
  return usuario && nombre ? `https://github.com/${usuario}/${nombre}` : null;
})();

// ---------- Utilidades ----------
const t = (clave, vars = {}) =>
  (TEXTOS[estado.idioma][clave] ?? clave).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = (nombre) => (nombre ? nombre[estado.idioma] ?? nombre.en ?? "" : "");
const negritas = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const claseVar = (p) => `--clase: var(--c-${p.claseId ?? 0})`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function haceCuanto(fechaISO) {
  const seg = Math.round((new Date(fechaISO).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(estado.idioma, { numeric: "auto" });
  const pasos = [[60, "second"], [3600, "minute"], [86400, "hour"], [Infinity, "day"]];
  const div = [1, 60, 3600, 86400];
  for (let i = 0; i < pasos.length; i++) {
    if (Math.abs(seg) < pasos[i][0]) return rtf.format(Math.round(seg / div[i]), pasos[i][1]);
  }
}

const SPEC_ROL = {
  Protection: "tanque", Guardian: "tanque",
  Holy: "sanador", Discipline: "sanador", Restoration: "sanador",
};
const rol = (p) => (p.especializacion ? SPEC_ROL[p.especializacion.en] ?? "dano" : null);

async function cargar(ruta, porDefecto) {
  const res = await fetch(`${ruta}?v=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404 && porDefecto !== undefined) return porDefecto;
  if (!res.ok) throw new Error(`${ruta}: HTTP ${res.status}`);
  return res.json();
}

// ---------- Carga ----------
async function cargarTodo() {
  const main = document.getElementById("contenido");
  try {
    const [datos, historial, avisos, ajustes, objetos] = await Promise.all([
      cargar("datos/personajes.json", null),
      cargar("datos/historial.json", []),
      cargar("datos/avisos.json", []),
      cargar("config/ajustes.json", null),
      cargar("datos/objetos.json", {}),
    ]);
    Object.assign(estado, { datos, historial, avisos, ajustes, objetos });
    if (!datos || !datos.personajes?.length) {
      main.innerHTML = `<p class="estado">${esc(t("sinDatos"))}</p>`;
      pintarCabecera();
      return;
    }
    const validos = datos.personajes.filter((p) => !p.error);
    if (!estado.seleccionado || !validos.some((p) => p.clave === estado.seleccionado)) {
      estado.seleccionado = validos[0]?.clave ?? null;
    }
    pintar();
  } catch (e) {
    main.innerHTML = `<p class="estado">${esc(t("errorCarga", { detalle: e.message }))}</p>`;
  }
}

// ---------- Pintado ----------
function pintar() {
  ocultarFicha();
  pintarCabecera();
  const main = document.getElementById("contenido");
  main.innerHTML = [seccionGrupo(), `<div class="row">${seccionEquipo()}${seccionAvisos()}</div>`, seccionProgreso(), seccionDondeIr()].join("");
  enlazarEventos();
}

function pintarCabecera() {
  document.documentElement.lang = estado.idioma;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === estado.idioma)));
  const tema = document.documentElement.dataset.theme;
  document.querySelectorAll("[data-theme-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeBtn === tema)));

  const sync = document.getElementById("ultima-sync");
  sync.textContent = estado.datos?.fecha ? t("ultimaSync", { hace: haceCuanto(estado.datos.fecha) }) : "";

  // Admin: el botón abre el workflow de sincronización en GitHub. Resto: recarga los datos.
  const btn = document.getElementById("btn-actualizar");
  if (admin && repo) {
    btn.textContent = t("actualizar");
    btn.href = `${repo}/actions/workflows/sincronizar.yml`;
    btn.target = "_blank";
    btn.rel = "noopener";
  } else {
    btn.textContent = t("recargar");
    btn.href = "#";
    btn.removeAttribute("target");
  }
}

// Grupo
function seccionGrupo() {
  const tarjetas = estado.datos.personajes.map(tarjetaPersonaje);
  if (admin) tarjetas.push(tarjetaAnadir());
  return `<section id="grupo" aria-labelledby="t-grupo" style="display:flex;flex-direction:column;gap:16px">
    <h2 id="t-grupo">${esc(t("grupo"))}</h2>
    <div class="cards">${tarjetas.join("")}</div>
  </section>`;
}

function tarjetaPersonaje(p) {
  if (p.error) {
    return `<article class="card card--error">
      <div class="card__top"><div class="avatar" aria-hidden="true">?</div>
        <div><div class="card__name">${esc(p.nombre)}</div><div class="card__sub">${esc(n(p.ruleset))}</div></div></div>
      <p class="empty">${esc(t("noEncontrado"))}</p>
    </article>`;
  }
  const r = rol(p);
  const obj = p.objetivo;
  const sub = [n(p.clase), p.especializacion ? n(p.especializacion) : null].filter(Boolean).join(" · ");
  const profs =
    p.profesiones === null
      ? `<p class="empty small">${esc(t("profesionesNoDisponibles"))}</p>`
      : p.profesiones.length === 0
      ? `<p class="empty small">${esc(t("sinProfesiones"))}</p>`
      : p.profesiones
          .map(
            (x) => `<div class="bar-block">
              <div class="bar-label"><span>${esc(n(x.nombre))}</span><strong>${x.nivel}${x.max ? `/${x.max}` : ""}</strong></div>
              <div class="bar bar--thin"><span style="width:${pct(x.nivel, x.max ?? 300)}%"></span></div>
            </div>`
          )
          .join("");
  return `<article class="card" style="${claseVar(p)}">
    <div class="card__top">
      <div class="avatar" aria-hidden="true" data-letra="${esc(p.nombre.charAt(0).toUpperCase())}">${
        p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(p.nombre.charAt(0).toUpperCase())
      }</div>
      <div><div class="card__name">${esc(p.nombre)}</div><div class="card__sub">${esc(sub)}</div></div>
      ${r ? `<span class="badge badge--${r}">${esc(t(r))}</span>` : ""}
    </div>
    <div class="stats">
      <div class="stat"><div class="stat__label">${esc(t("nivel"))}</div><div class="stat__value">${p.nivel}</div></div>
      <div class="stat"><div class="stat__label">${esc(t("nivelObjeto"))}</div><div class="stat__value">${p.nivelObjeto ?? "—"}</div></div>
    </div>
    <div class="bar-block">
      <div class="bar-label"><span class="muted">${esc(t("progresoObjetivo"))}</span>
        <strong>${obj.total ? esc(t("piezas", { n: obj.conseguidas.length, total: obj.total })) : esc(t("sinLista"))}</strong></div>
      <div class="bar"><span style="width:${pct(obj.conseguidas.length, obj.total)}%"></span></div>
    </div>
    <div class="profs" style="${claseVar(p)}">
      <span class="profs__title">${esc(t("profesiones"))}</span>${profs}
    </div>
    ${enlacePerfil(p)}
  </article>`;
}

// Enlace al perfil del personaje (Armería u otra web) a partir de la plantilla de config/ajustes.json
function enlacePerfil(p) {
  const plantilla = estado.ajustes?.enlacePerfil;
  if (!plantilla) return "";
  // En Forever no hay reinos: el personaje se identifica por {nombre}-{apellido} (p.clave)
  const [nombre, ...resto] = p.nombre.split(" ");
  const url = plantilla
    .replace("{idioma}", estado.idioma === "es" ? "es-es" : "en-gb")
    .replace("{region}", encodeURIComponent(estado.ajustes.region ?? "eu"))
    .replace("{slug}", encodeURIComponent(p.clave))
    .replace("{nombre}", encodeURIComponent(nombre.toLowerCase()))
    .replace("{apellido}", encodeURIComponent(resto.join(" ").toLowerCase()));
  return `<a class="perfil-link" href="${esc(url)}" target="_blank" rel="noopener">${esc(t("verPerfil"))}
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>`;
}

function tarjetaAnadir() {
  const enlace = repo ? `${repo}/actions/workflows/anadir-amigo.yml` : "#";
  return `<article class="card card--add">
    <div class="card__top"><span class="card__name">${esc(t("anadirAmigo"))}</span>
      <span class="badge badge--tanque lock"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>${esc(t("soloAdmin"))}</span></div>
    <p class="empty small">${esc(t("anadirTexto"))}</p>
    <a class="btn btn--primary" href="${esc(enlace)}" target="_blank" rel="noopener">${esc(t("anadirBoton"))}</a>
  </article>`;
}

// Nombre de objeto: al pulsarlo se abre su ficha; se cierra pulsando fuera (o en el mismo nombre)
function objetoHtml(id, nombre, calidad) {
  const tiene = estado.objetos[id]?.detalle;
  const texto = esc(n(nombre));
  return tiene
    ? `<button type="button" class="objeto q-${esc(calidad)}" data-objeto="${id}" aria-expanded="false" aria-controls="ficha">${texto}</button>`
    : `<span class="q-${esc(calidad)}">${texto}</span>`;
}

function fichaHtml(id) {
  const o = estado.objetos[id];
  if (!o?.detalle) return "";
  const d = o.detalle;
  const linea = (x) => `<div>${esc(n(x))}</div>`;
  return `<div class="ficha__nombre q-${esc(o.calidad)}">${esc(n(o.nombre))}</div>
    ${d.nivel ? `<div class="ficha__nivel">${esc(t("nivelObjetoN", { n: d.nivel }))}</div>` : ""}
    ${d.vinculo ? linea(d.vinculo) : ""}
    ${d.ranura || d.tipo ? `<div class="ficha__fila"><span>${esc(n(d.ranura))}</span><span>${esc(n(d.tipo))}</span></div>` : ""}
    ${d.lineas.map((l) => `<div class="${/^\s*(Equipar|Equip|Uso|Use|Probabilidad|Chance)/i.test(n(l)) ? "ficha__efecto" : ""}">${esc(n(l))}</div>`).join("")}
    ${d.nivelRequerido ? `<div class="ficha__req">${esc(t("requiereNivel", { n: d.nivelRequerido }))}</div>` : ""}`;
}

const ficha = document.createElement("div");
ficha.id = "ficha";
ficha.className = "ficha";
ficha.setAttribute("role", "tooltip");
ficha.hidden = true;
document.body.appendChild(ficha);
let fichaDe = null;

function mostrarFicha(boton) {
  const html = fichaHtml(boton.dataset.objeto);
  if (!html) return;
  ficha.innerHTML = html;
  ficha.hidden = false;
  fichaDe?.setAttribute("aria-expanded", "false");
  fichaDe = boton;
  boton.setAttribute("aria-expanded", "true");
  colocarFicha();
}
// Coloca la ficha junto al objeto (debajo, o encima si no cabe). Al hacer scroll la ficha le sigue.
function colocarFicha() {
  if (!fichaDe) return;
  const r = fichaDe.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return ocultarFicha(); // el objeto ya no se ve
  const fw = ficha.offsetWidth, fh = ficha.offsetHeight, m = 8;
  let top = r.bottom + m;
  if (top + fh > innerHeight - m) top = Math.max(m, r.top - fh - m); // si no cabe debajo, va encima
  const left = Math.min(Math.max(m, r.left), innerWidth - fw - m);
  ficha.style.top = `${top}px`;
  ficha.style.left = `${left}px`;
}
function ocultarFicha() {
  ficha.hidden = true;
  fichaDe?.setAttribute("aria-expanded", "false");
  fichaDe = null;
}
// Pulsar un objeto abre su ficha (pulsarlo otra vez la cierra)
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-objeto]");
  if (b) fichaDe === b ? ocultarFicha() : mostrarFicha(b);
});
// Pulsar en cualquier otro sitio la cierra. Se usa "pointerdown" porque en iPhone/iPad
// los toques en zonas sin enlaces ni botones no generan "click".
document.addEventListener("pointerdown", (e) => {
  if (!fichaDe) return;
  if (e.target.closest?.("[data-objeto]") || ficha.contains(e.target)) return;
  ocultarFicha();
}, true);
// Si se pulsa fuera de la página (otra ventana, la barra del navegador, el panel que la contiene…)
addEventListener("blur", ocultarFicha);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") ocultarFicha(); });
addEventListener("scroll", colocarFicha, { passive: true });
addEventListener("resize", colocarFicha);

// Celda de objetivo cuando la ranura no tiene ninguno fijado
const NIVEL_MAX = 60;
function huecoObjetivo(p) {
  const texto = p.nivel < NIVEL_MAX ? t("loQueCaiga") : t("sinObjetivo");
  let enlace = "";
  if (admin && p.objetivo.lista) {
    const ruta = `config/objetivos/${p.objetivo.lista}.json`;
    const href = !repo ? "#" : p.objetivo.total ? `${repo}/edit/main/${ruta}` : `${repo}/new/main/config/objetivos?filename=${p.objetivo.lista}.json`;
    enlace = `<a class="fijar" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(t("fijarObjetivo"))}" title="${esc(t("fijarObjetivo"))}">+</a>`;
  }
  return `<span class="celda-hueco"><span class="hueco">${esc(texto)}</span>${enlace}</span>`;
}

// Equipo
function seccionEquipo() {
  const validos = estado.datos.personajes.filter((p) => !p.error);
  const p = validos.find((x) => x.clave === estado.seleccionado);
  const botones = validos
    .map((x) => `<button type="button" class="chip-btn" data-personaje="${esc(x.clave)}" aria-pressed="${x.clave === estado.seleccionado}">${esc(x.nombre)}</button>`)
    .join("");

  let cuerpo = "";
  let pie = "";
  if (p) {
    const objetivos = new Map(p.objetivo.ranuras.map((r) => [r.ranura, r]));
    const equipadas = new Map(p.equipo.map((e) => [e.ranura, e]));
    const ranuras = ORDEN_RANURAS.filter((r) => equipadas.has(r) || objetivos.has(r));
    for (const extra of [...equipadas.keys(), ...objetivos.keys()]) if (!ranuras.includes(extra)) ranuras.push(extra);

    cuerpo = ranuras
      .map((r) => {
        const e = equipadas.get(r);
        const o = objetivos.get(r);
        const nombreRanura = e ? n(e.ranuraNombre) : n(RANURAS[r]) || r;
        const objetivoHtml = o
          ? o.opciones.map((op, i) => (i === 0 ? objetoHtml(op.id, op.nombre, op.calidad) : `<span class="alt">${objetoHtml(op.id, op.nombre, op.calidad)}</span>`)).join("")
          : huecoObjetivo(p);
        const fuente = o ? [...new Set(o.opciones.map((op) => op.fuente).filter(Boolean))].join(" / ") : "";
        const estadoHtml = o
          ? o.conseguida
            ? `<span class="estado-tag estado-tag--ok">${esc(t("conseguido"))}</span>`
            : `<span class="estado-tag estado-tag--pend">${esc(t("pendiente"))}</span>`
          : `<span class="tenue" aria-hidden="true">—</span>`;
        return `<tr>
          <td class="slot">${esc(nombreRanura)}</td>
          <td>${e ? objetoHtml(e.id, e.nombre, e.calidad) : `<span class="muted">${esc(t("nada"))}</span>`}</td>
          <td>${objetivoHtml}</td>
          <td>${esc(fuente) || `<span class="tenue" aria-hidden="true">—</span>`}</td>
          <td>${estadoHtml}</td>
        </tr>`;
      })
      .join("");

    if (p.objetivo.lista && p.objetivo.total === 0) pie = `<p class="empty small">${esc(t("listaNoExiste", { lista: p.objetivo.lista }))}</p>`;
    else if (p.objetivo.lista) pie = `<p class="empty small">${esc(t("listaUsada", { lista: p.objetivo.lista }))}</p>`;
  }

  return `<section id="equipo" class="panel grow" aria-labelledby="t-equipo">
    <div class="panel__head">
      <h2 id="t-equipo">${esc(t("equipo"))}</h2>
      <div class="group-btns" role="group" aria-label="${esc(t("elegirPersonaje"))}">${botones}</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">${esc(t("ranura"))}</th><th scope="col">${esc(t("equipado"))}</th><th scope="col">${esc(t("objetivo"))}</th><th scope="col">${esc(t("fuente"))}</th><th scope="col">${esc(t("estado"))}</th></tr></thead>
      <tbody>${cuerpo}</tbody>
    </table></div>
    ${pie}
  </section>`;
}

// Avisos
function seccionAvisos() {
  const a = estado.ajustes?.avisos;
  const fila = (texto, on) => `<li><span>${esc(texto)}</span><span class="${on ? "on" : "off"}">${esc(t(on ? "activado" : "desactivado"))}</span></li>`;
  const lista = a
    ? `<ul class="ajustes-list">
        ${fila(t("avisoNivel"), a.subidaNivel)}
        ${fila(t("avisoObjetivo"), a.piezaObjetivo)}
        ${fila(t("avisoProfesion", { n: a.umbralProfesion }), a.subidaProfesion)}
        ${fila(t("avisoResumen"), a.resumenSemanal !== false)}
      </ul>`
    : "";
  const feed = estado.avisos.length
    ? estado.avisos
        .slice(0, 6)
        .map((x) => `<div class="feed__item"><span>${negritas(n(x.texto))}</span><time datetime="${esc(x.fecha)}">${esc(haceCuanto(x.fecha))}</time></div>`)
        .join("")
    : `<p class="empty">${esc(t("sinAvisos"))}</p>`;
  // Solo el admin ve el botón; abre config/ajustes.json en GitHub para activar o desactivar avisos
  const editar = admin
    ? `<a class="btn btn--outline btn--ajustes" href="${repo ? `${repo}/edit/main/config/ajustes.json` : "#"}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
        ${esc(t("editarAjustes"))}</a>`
    : "";

  return `<section id="avisos" class="panel side" aria-labelledby="t-avisos">
    <h2 id="t-avisos">${esc(t("avisos"))}</h2>
    <div style="display:flex;flex-direction:column;gap:8px"><span class="profs__title">${esc(t("queSeAvisa"))}</span>${lista}${editar}</div>
    <div style="display:flex;flex-direction:column;gap:8px"><span class="profs__title">${esc(t("ultimosAvisos"))}</span><div class="feed">${feed}</div></div>
  </section>`;
}

// Progreso
// Cada personaje tiene su propio color en la gráfica (paleta definida en styles.css: --serie-0 … --serie-7)
const COLORES_SERIE = 8;
const colorSerie = (i) => `var(--serie-${i % COLORES_SERIE})`;

function valorMetrica(punto) {
  if (!punto) return null;
  if (estado.metrica === "nivel") return punto.nivel;
  if (estado.metrica === "objetivo") return punto.objetivo;
  const vals = Object.values(punto.profesiones ?? {});
  return vals.length ? Math.max(...vals) : null;
}

function seccionProgreso() {
  const personajes = estado.datos.personajes.filter((p) => !p.error);
  const metricas = [["nivel", "metricaNivel"], ["objetivo", "metricaObjetivo"], ["profesion", "metricaProfesion"]];
  const botones = metricas
    .map(([m, k]) => `<button type="button" class="chip-btn" data-metrica="${m}" aria-pressed="${estado.metrica === m}">${esc(t(k))}</button>`)
    .join("");
  const leyenda = personajes
    .map((p, i) => `<button type="button" data-serie="${esc(p.clave)}" aria-pressed="${!estado.ocultos.has(p.clave)}" aria-label="${esc(t("mostrarOcultar", { nombre: p.nombre }))}" style="${claseVar(p)}">
        <svg viewBox="0 0 22 6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke="${colorSerie(i)}" stroke-width="4" stroke-linecap="round"/></svg>${esc(p.nombre)}</button>`)
    .join("");

  return `<section id="progreso" class="panel" aria-labelledby="t-progreso">
    <div class="panel__head">
      <h2 id="t-progreso">${esc(t("progreso"))}</h2>
      <div class="group-btns" role="group" aria-label="${esc(t("queMostrar"))}">${botones}</div>
    </div>
    <div class="legend">${leyenda}</div>
    <div class="chart table-wrap">${grafica(personajes)}</div>
  </section>`;
}

function grafica(personajes) {
  const h = estado.historial;
  if (h.length < 2) return `<p class="empty">${esc(t("pocosDatos"))}</p>`;

  const W = 1200, H = 300, I = 50, D = 20, A = 20, B = 40;
  const t0 = new Date(h[0].fecha).getTime();
  const t1 = new Date(h[h.length - 1].fecha).getTime() || t0 + 1;
  const series = personajes
    .map((p, i) => ({ p, i, pts: h.map((e) => [new Date(e.fecha).getTime(), valorMetrica(e.personajes[p.clave])]).filter(([, v]) => v !== null) }))
    .filter((s) => !estado.ocultos.has(s.p.clave) && s.pts.length);

  const todos = series.flatMap((s) => s.pts.map(([, v]) => v));
  if (!todos.length) todos.push(0);
  const maxV = Math.max(1, ...todos);
  const minV = estado.metrica === "nivel" ? Math.max(0, Math.min(...todos) - 1) : 0;
  const x = (tt) => I + ((tt - t0) / Math.max(1, t1 - t0)) * (W - I - D);
  const y = (v) => A + (1 - (v - minV) / Math.max(1, maxV - minV)) * (H - A - B);

  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(minV + f * (maxV - minV)));
  const grid = [...new Set(marcas)].map((v) => `<line x1="${I}" x2="${W - D}" y1="${y(v)}" y2="${y(v)}"/><text x="${I - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
  const fecha = (tt) => new Date(tt).toLocaleDateString(estado.idioma, { day: "numeric", month: "short" });
  const ejeX = `<text x="${I}" y="${H - 12}">${esc(fecha(t0))}</text><text x="${W - D}" y="${H - 12}" text-anchor="end">${esc(fecha(t1))}</text>`;

  const lineas = series
    .map(({ p, i, pts }) => {
      // escalón: el valor se mantiene hasta el siguiente cambio
      const d = pts.map(([tt, v], k) => `${k ? `H${x(tt).toFixed(1)}V` : `M${x(tt).toFixed(1)},`}${y(v).toFixed(1)}`).join("") + `H${x(t1).toFixed(1)}`;
      return `<path class="serie" d="${d}" stroke="${colorSerie(i)}"/>`;
    })
    .join("");

  const metricaTxt = t({ nivel: "metricaNivel", objetivo: "metricaObjetivo", profesion: "metricaProfesion" }[estado.metrica]).toLowerCase();
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("graficaAria", { metrica: metricaTxt }))}">
    <g class="grid">${grid}</g>${ejeX}${lineas}</svg>`;
}

// Dónde ir juntos
function seccionDondeIr() {
  const lugares = new Map(); // fuente -> Map(clave -> {p, piezas})
  for (const p of estado.datos.personajes.filter((x) => !x.error)) {
    for (const r of p.objetivo.ranuras) {
      if (r.conseguida) continue;
      for (const f of new Set(r.opciones.map((o) => o.fuente).filter(Boolean))) {
        if (!lugares.has(f)) lugares.set(f, new Map());
        const m = lugares.get(f);
        m.set(p.clave, { p, piezas: (m.get(p.clave)?.piezas ?? 0) + 1 });
      }
    }
  }
  const orden = [...lugares.entries()]
    .map(([f, m]) => ({ f, quienes: [...m.values()], total: [...m.values()].reduce((s, q) => s + q.piezas, 0) }))
    .sort((a, b) => b.quienes.length - a.quienes.length || b.total - a.total)
    .slice(0, 6);

  const contenido = orden.length
    ? `<div class="places">${orden
        .map(
          (l) => `<div class="place">
            <span class="place__name">${esc(l.f)}</span>
            <span class="muted small">${esc(t("personasPiezas", { p: l.quienes.length, n: l.total }))}</span>
            <div class="tags">${l.quienes.map((q) => `<span class="tag" style="${claseVar(q.p)}">${esc(q.p.nombre)}: ${q.piezas}</span>`).join("")}</div>
          </div>`
        )
        .join("")}</div>`
    : `<p class="empty">${esc(t("sinFuentes"))}</p>`;

  return `<section id="objetivos" class="panel" aria-labelledby="t-objetivos">
    <h2 id="t-objetivos">${esc(t("dondeIr"))}</h2>
    <p class="empty small">${esc(t("dondeIrTexto"))}</p>
    ${contenido}
  </section>`;
}

// ---------- Eventos ----------
function enlazarEventos() {
  // Si una imagen no carga (retrato o icono), se vuelve a la inicial
  document.querySelectorAll(".avatar img").forEach((img) =>
    img.addEventListener("error", () => { const av = img.parentElement; av.textContent = av.dataset.letra; }, { once: true })
  );
  document.querySelectorAll("[data-personaje]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.seleccionado = b.dataset.personaje;
      repintar("#equipo", seccionEquipo);
    })
  );
  document.querySelectorAll("[data-metrica]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.metrica = b.dataset.metrica;
      repintar("#progreso", seccionProgreso);
    })
  );
  document.querySelectorAll("[data-serie]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = b.dataset.serie;
      estado.ocultos.has(c) ? estado.ocultos.delete(c) : estado.ocultos.add(c);
      repintar("#progreso", seccionProgreso);
    })
  );
}

function repintar(selector, fn) {
  ocultarFicha();
  const viejo = document.querySelector(selector);
  const foco = document.activeElement?.dataset;
  viejo.outerHTML = fn();
  enlazarEventos();
  // Mantiene el foco del teclado en el botón pulsado
  const k = foco && Object.keys(foco)[0];
  if (k) document.querySelector(`[data-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}="${CSS.escape(foco[k])}"]`)?.focus();
}

// Idioma y tema (botones de la cabecera, fijos)
document.querySelectorAll("[data-lang]").forEach((b) =>
  b.addEventListener("click", () => {
    estado.idioma = b.dataset.lang;
    try { localStorage.setItem("wfy-idioma", estado.idioma); } catch {}
    estado.datos?.personajes?.length ? pintar() : pintarCabecera();
  })
);
document.querySelectorAll("[data-theme-btn]").forEach((b) =>
  b.addEventListener("click", () => {
    document.documentElement.dataset.theme = b.dataset.themeBtn;
    try { localStorage.setItem("wfy-tema", b.dataset.themeBtn); } catch {}
    pintarCabecera();
  })
);
document.getElementById("btn-actualizar").addEventListener("click", (e) => {
  if (!(admin && repo)) {
    e.preventDefault();
    cargarTodo();
  }
});

// Botón "volver arriba": aparece al bajar un poco la página
const arriba = document.getElementById("arriba");
const revisarArriba = () => { arriba.hidden = scrollY < 400; };
addEventListener("scroll", revisarArriba, { passive: true });
arriba.addEventListener("click", () => {
  const suave = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollTo({ top: 0, behavior: suave ? "smooth" : "auto" });
  document.querySelector(".logo")?.focus({ preventScroll: true }); // el foco del teclado también vuelve arriba
});
revisarArriba();

// Año del copyright del pie, siempre el actual
document.getElementById("anio").textContent = new Date().getFullYear();

pintarCabecera();
cargarTodo();
// Refresca solo cada 10 minutos por si el workflow ha publicado datos nuevos
setInterval(cargarTodo, 10 * 60 * 1000);
