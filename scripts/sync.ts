/**
 * WForYou · sincronización
 * 1. Pide un token de aplicación a Battle.net (client credentials).
 * 2. Descarga resumen, equipo y profesiones de cada personaje de config/personajes.json.
 *    En WoW: Forever no hay reinos: cada personaje se identifica por nombre y apellido
 *    (únicos por región) y la API lo busca como /profile/wow/character/{nombre}-{apellido}.
 * 3. Resuelve los nombres de los objetos de las listas objetivo (con caché en datos/objetos.json).
 * 4. Guarda datos/personajes.json y añade una entrada a datos/historial.json.
 * 5. Compara con la foto anterior, guarda los avisos en datos/avisos.json y los envía a Discord.
 *
 * Variables de entorno (secrets de GitHub):
 *   BNET_CLIENT_ID, BNET_CLIENT_SECRET  → obligatorias
 *   DISCORD_WEBHOOK_URL                 → opcional (sin ella no se envían avisos a Discord)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { COLOR_CLASE, COLOR_WFORYOU, enviarEmbeds, urlValida, type Embed } from "./discord.js";

// ---------- Tipos ----------
type Nombre = { es: string; en: string };

interface Ajustes {
  region: string;
  namespaceProfile: string;
  namespaceStatic: string;
  idiomaAvisos: "es" | "en";
  avisos: {
    subidaNivel: boolean;
    piezaObjetivo: boolean;
    subidaProfesion: boolean;
    umbralProfesion: number;
  };
  /** Dirección pública de la web, para enlazarla desde Discord (opcional) */
  urlWeb?: string;
}

interface EntradaConfig {
  nombre: string;
  apellido: string;
  /**
   * Lista objetivo: nombre de archivo en config/objetivos sin .json, p. ej. "warrior-protection".
   * En Forever la API no da la especialización activa, así que conviene indicarla aquí:
   * también sirve para saber la especialización y el rol (tanque, sanador o daño).
   */
  objetivo?: string;
  /** Formato antiguo (con reinos): ya no se usa en Forever */
  reino?: string;
}

/** En las listas objetivo cada opción puede ser un ID o { id, fuente } */
type OpcionConfig = number | { id: number; fuente?: string };

interface Pieza {
  ranura: string; // HEAD, CHEST…
  ranuraNombre: Nombre;
  id: number;
  nombre: Nombre;
  calidad: string;
}

interface Profesion {
  nombre: Nombre;
  nivel: number;
  max: number | null;
}

interface RanuraObjetivo {
  ranura: string;
  opciones: { id: number; nombre: Nombre; calidad: string; fuente: string | null }[];
  conseguida: number | null; // id equipado que cumple el objetivo
}

interface Personaje {
  clave: string; // slug nombre-apellido, p. ej. "arrows-skarchh"
  nombre: string; // nombre completo para mostrar: "Arrows Skarchh"
  ruleset: Nombre | null; // tipo de servidor (Normal, JcJ, Rol…) en lugar del reino
  nivel: number;
  clase: Nombre;
  claseId: number | null;
  /** Retrato del personaje o, si no hay, icono de la clase (URL del CDN de Blizzard) */
  imagen: string | null;
  raza: Nombre;
  especializacion: Nombre | null;
  nivelObjeto: number | null;
  equipo: Pieza[];
  profesiones: Profesion[] | null; // null = la API no lo expone
  objetivo: { lista: string | null; total: number; conseguidas: number[]; ranuras: RanuraObjetivo[] };
  error?: string;
}

interface Foto {
  fecha: string;
  personajes: Personaje[];
}

interface Aviso {
  fecha: string;
  tipo: "nivel" | "objetivo" | "profesion";
  personaje: string;
  texto: Nombre;
}

/** Ficha del objeto para el tooltip de la web */
interface Detalle {
  nivel: number | null;
  nivelRequerido: number | null;
  ranura: Nombre | null; // "Cabeza", "Una mano"…
  tipo: Nombre | null;   // "Placas", "Hacha"…
  vinculo: Nombre | null;
  lineas: Nombre[];      // armadura, estadísticas, daño, efectos…
}
type CacheObjetos = Record<string, { nombre: Nombre; calidad: string; detalle?: Detalle | null; fecha?: string }>;

/**
 * Términos de uso de la API de Blizzard (punto 2.18): ningún dato obtenido de la API
 * puede conservarse más de 30 días. Todo lo que guardamos respeta este límite.
 */
const RETENCION_MS = 30 * 24 * 3600 * 1000;
const caducado = (iso?: string) => !iso || Date.now() - new Date(iso).getTime() > RETENCION_MS;

// ---------- Utilidades ----------
const leerJSON = async <T>(ruta: string, porDefecto: T): Promise<T> =>
  existsSync(ruta) ? (JSON.parse(await readFile(ruta, "utf8")) as T) : porDefecto;

const escribirJSON = (ruta: string, datos: unknown) =>
  writeFile(ruta, JSON.stringify(datos, null, 2) + "\n", "utf8");

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** Sin parámetro locale, Blizzard devuelve los nombres con todos los idiomas: { en_US, es_ES, … } */
const nombre = (v: unknown): Nombre => {
  if (typeof v === "string") return { es: v, en: v };
  const o = (v ?? {}) as Record<string, string>;
  const en = o.en_US ?? o.en_GB ?? Object.values(o)[0] ?? "";
  return { es: o.es_ES ?? o.es_MX ?? en, en };
};

// ---------- API de Blizzard ----------
async function pedirToken(): Promise<string> {
  const id = process.env.BNET_CLIENT_ID;
  const secreto = process.env.BNET_CLIENT_SECRET;
  if (!id || !secreto) throw new Error("Faltan BNET_CLIENT_ID / BNET_CLIENT_SECRET");

  const res = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secreto}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Token: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

function crearCliente(token: string, region: string) {
  const base = `https://${region}.api.blizzard.com`;
  return async function get<T>(ruta: string, namespace: string): Promise<T | null> {
    const url = `${base}${ruta}?namespace=${encodeURIComponent(namespace)}`;
    for (let intento = 1; intento <= 3; intento++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404) return null; // personaje, objeto o endpoint inexistente
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * intento));
        continue;
      }
      if (!res.ok) throw new Error(`${ruta}: HTTP ${res.status}`);
      return (await res.json()) as T;
    }
    throw new Error(`${ruta}: sin respuesta tras 3 intentos`);
  };
}
type Get = ReturnType<typeof crearCliente>;

// ---------- Especialización ----------
// Nombres de especialización por su slug en inglés (el que se usa en los nombres de las listas objetivo)
const SPECS: Record<string, Nombre> = {
  arms: { es: "Armas", en: "Arms" }, fury: { es: "Furia", en: "Fury" }, protection: { es: "Protección", en: "Protection" },
  holy: { es: "Sagrado", en: "Holy" }, retribution: { es: "Reprensión", en: "Retribution" },
  discipline: { es: "Disciplina", en: "Discipline" }, shadow: { es: "Sombra", en: "Shadow" },
  "beast-mastery": { es: "Dominio de bestias", en: "Beast Mastery" }, marksmanship: { es: "Puntería", en: "Marksmanship" }, survival: { es: "Supervivencia", en: "Survival" },
  assassination: { es: "Asesinato", en: "Assassination" }, combat: { es: "Combate", en: "Combat" }, subtlety: { es: "Sutileza", en: "Subtlety" },
  elemental: { es: "Elemental", en: "Elemental" }, enhancement: { es: "Mejora", en: "Enhancement" }, restoration: { es: "Restauración", en: "Restoration" },
  arcane: { es: "Arcano", en: "Arcane" }, fire: { es: "Fuego", en: "Fire" }, frost: { es: "Escarcha", en: "Frost" },
  affliction: { es: "Aflicción", en: "Affliction" }, demonology: { es: "Demonología", en: "Demonology" }, destruction: { es: "Destrucción", en: "Destruction" },
  balance: { es: "Equilibrio", en: "Balance" }, feral: { es: "Feral", en: "Feral" }, "feral-combat": { es: "Combate feral", en: "Feral Combat" }, guardian: { es: "Guardián", en: "Guardian" },
};

/**
 * Especialización del personaje. Por orden:
 * 1) active_spec del perfil (en Forever no viene, de momento);
 * 2) el endpoint /specializations (especialización activa o, en el estilo Classic, el árbol con más puntos);
 * 3) la que indique la lista objetivo de config/personajes.json (p. ej. "warrior-protection" → Protección).
 */
function especializacion(resumen: any, specs: any, clase: Nombre, objetivo?: string): Nombre | null {
  if (resumen?.active_spec?.name) return nombre(resumen.active_spec.name);
  if (specs?.active_specialization?.name) return nombre(specs.active_specialization.name);
  const grupo = (specs?.specialization_groups ?? []).find((g: any) => g.is_active) ?? specs?.specialization_groups?.[0];
  const arboles: any[] = grupo?.specializations ?? specs?.specializations ?? [];
  const mejor = arboles
    .filter((a) => (a.spent_points ?? 0) > 0)
    .sort((a, b) => (b.spent_points ?? 0) - (a.spent_points ?? 0))[0];
  if (mejor?.specialization_name) return nombre(mejor.specialization_name);
  if (objetivo) {
    const resto = objetivo.startsWith(slug(clase.en) + "-") ? objetivo.slice(slug(clase.en).length + 1) : objetivo.split("-").slice(1).join("-");
    if (SPECS[resto]) return SPECS[resto];
  }
  return null;
}

// ---------- Listas objetivo ----------
async function leerLista(lista: string): Promise<Record<string, { id: number; fuente: string | null }[]> | null> {
  const datos = await leerJSON<{ piezas: Record<string, OpcionConfig[]> } | null>(`config/objetivos/${lista}.json`, null);
  if (!datos) return null;
  const limpio: Record<string, { id: number; fuente: string | null }[]> = {};
  for (const [ranura, opciones] of Object.entries(datos.piezas)) {
    const ops = opciones
      .map((o) => (typeof o === "number" ? { id: o, fuente: null } : { id: o.id, fuente: o.fuente ?? null }))
      .filter((o) => o.id > 0);
    if (ops.length) limpio[ranura] = ops;
  }
  return limpio;
}

function detalleObjeto(it: any): Detalle {
  const pv = it.preview_item ?? {};
  const txt = (x: any) => (x?.display_string ? nombre(x.display_string) : x?.display?.display_string ? nombre(x.display.display_string) : null);
  const lineas: (Nombre | null)[] = [
    txt(pv.armor),
    pv.weapon ? txt(pv.weapon.damage) : null,
    pv.weapon ? txt(pv.weapon.attack_speed) : null,
    pv.weapon ? txt(pv.weapon.dps) : null,
    ...(pv.stats ?? []).map((st: any) => txt(st)),
    ...(pv.spells ?? []).map((sp: any) => (sp.description ? nombre(sp.description) : null)),
    txt(pv.durability),
  ];
  return {
    nivel: it.level ?? null,
    nivelRequerido: it.required_level ?? null,
    ranura: it.inventory_type?.name ? nombre(it.inventory_type.name) : null,
    tipo: it.item_subclass?.name ? nombre(it.item_subclass.name) : null,
    vinculo: pv.binding?.name ? nombre(pv.binding.name) : null,
    lineas: lineas.filter((l): l is Nombre => !!l && !!l.en),
  };
}

/** Nombre, calidad y ficha de un objeto. Queda en datos/objetos.json y se vuelve a pedir pasados 30 días */
async function resolverObjeto(get: Get, ajustes: Ajustes, cache: CacheObjetos, id: number) {
  usados.add(String(id));
  if (!cache[id] || cache[id].detalle === undefined || caducado(cache[id].fecha)) {
    const it = await get<any>(`/data/wow/item/${id}`, ajustes.namespaceStatic).catch(() => null);
    cache[id] = it
      ? { nombre: nombre(it.name), calidad: it.quality?.type ?? "COMMON", detalle: detalleObjeto(it), fecha: new Date().toISOString() }
      : { nombre: { es: `Objeto #${id}`, en: `Item #${id}` }, calidad: "COMMON", detalle: null, fecha: new Date().toISOString() };
  }
  return cache[id];
}

/** Objetos usados en esta sincronización: los demás se borran de la caché */
const usados = new Set<string>();

// Icono de clase (se pide una vez por clase y ejecución)
const iconosClase = new Map<number, string | null>();
async function iconoClase(get: Get, ajustes: Ajustes, id: number): Promise<string | null> {
  if (!iconosClase.has(id)) {
    const m = await get<any>(`/data/wow/media/playable-class/${id}`, ajustes.namespaceStatic).catch(() => null);
    iconosClase.set(id, (m?.assets ?? []).find((x: any) => x.key === "icon")?.value ?? null);
  }
  return iconosClase.get(id) ?? null;
}

// ---------- Lectura de un personaje ----------
async function leerPersonaje(get: Get, ajustes: Ajustes, cache: CacheObjetos, entrada: EntradaConfig): Promise<Personaje> {
  // Forever: sin reino. El personaje es {nombre}-{apellido} en minúsculas
  // (se respetan tildes y eñes: la API las acepta codificadas en la URL)
  const clave = `${entrada.nombre.trim()}-${(entrada.apellido ?? "").trim()}`.toLowerCase();
  const rutaBase = `/profile/wow/character/${encodeURIComponent(clave)}`;
  const ns = ajustes.namespaceProfile;

  const [resumen, equipo, profesiones, media, specs] = await Promise.all([
    get<any>(rutaBase, ns),
    get<any>(`${rutaBase}/equipment`, ns),
    get<any>(`${rutaBase}/professions`, ns).catch(() => null),
    get<any>(`${rutaBase}/character-media`, ns).catch(() => null), // el retrato puede tardar horas en existir
    get<any>(`${rutaBase}/specializations`, ns).catch(() => null),
  ]);

  if (!resumen) {
    return {
      clave,
      nombre: `${entrada.nombre} ${entrada.apellido ?? ""}`.trim(),
      ruleset: null,
      nivel: 0,
      clase: { es: "?", en: "?" },
      claseId: null,
      imagen: null,
      raza: { es: "?", en: "?" },
      especializacion: null,
      nivelObjeto: null,
      equipo: [],
      profesiones: null,
      objetivo: { lista: null, total: 0, conseguidas: [], ranuras: [] },
      error: "not-found",
    };
  }

  const piezas: Pieza[] = (equipo?.equipped_items ?? []).map((it: any) => ({
    ranura: it.slot?.type ?? "?",
    ranuraNombre: nombre(it.slot?.name),
    id: it.item?.id ?? 0,
    nombre: nombre(it.name),
    calidad: it.quality?.type ?? "COMMON",
  }));

  // Ficha de cada pieza equipada (para el tooltip); queda en caché, así que solo cuesta la primera vez
  for (const pz of piezas) if (pz.id > 0) await resolverObjeto(get, ajustes, cache, pz.id);

  // Retail usa tiers por expansión; Classic suele dar skill_points directo. Aceptamos ambos.
  const profs: Profesion[] | null = profesiones
    ? [...(profesiones.primaries ?? []), ...(profesiones.secondaries ?? [])].map((p: any) => {
        const tier = p.tiers?.[p.tiers.length - 1];
        return {
          nombre: nombre(p.profession?.name),
          nivel: tier?.skill_points ?? p.skill_points ?? 0,
          max: tier?.max_skill_points ?? p.max_skill_points ?? null,
        };
      })
    : null;

  const clase = nombre(resumen.character_class?.name);
  const claseId: number | null = resumen.character_class?.id ?? null;
  const retrato = (media?.assets ?? []).find((x: any) => x.key === "avatar")?.value ?? media?.avatar_url ?? null;
  const imagen = retrato ?? (claseId ? await iconoClase(get, ajustes, claseId) : null);
  const spec = especializacion(resumen, specs, clase, entrada.objetivo);

  // Equipo objetivo
  const lista = entrada.objetivo ?? (spec ? `${slug(clase.en)}-${slug(spec.en)}` : null);
  const datosLista = lista ? await leerLista(lista) : null;
  const equipadas = new Set(piezas.map((p) => p.id));
  const ranuras: RanuraObjetivo[] = [];
  for (const [ranura, opciones] of Object.entries(datosLista ?? {})) {
    const resueltas = [];
    for (const o of opciones) {
      const info = await resolverObjeto(get, ajustes, cache, o.id);
      resueltas.push({ id: o.id, nombre: info.nombre, calidad: info.calidad, fuente: o.fuente });
    }
    ranuras.push({ ranura, opciones: resueltas, conseguida: opciones.find((o) => equipadas.has(o.id))?.id ?? null });
  }

  return {
    clave,
    nombre: [resumen.name ?? entrada.nombre, resumen.surname ?? entrada.apellido].filter(Boolean).join(" "),
    ruleset: resumen.ruleset?.name ? nombre(resumen.ruleset.name) : null,
    nivel: resumen.level ?? 0,
    clase,
    claseId,
    imagen,
    raza: nombre(resumen.race?.name),
    especializacion: spec,
    nivelObjeto: resumen.equipped_item_level ?? resumen.average_item_level ?? null,
    equipo: piezas,
    profesiones: profs,
    objetivo: {
      lista,
      total: ranuras.length,
      conseguidas: ranuras.map((r) => r.conseguida).filter((x): x is number => x !== null),
      ranuras,
    },
  };
}

// ---------- Avisos ----------
function compararFotos(anterior: Foto | null, actual: Foto, ajustes: Ajustes): Aviso[] {
  if (!anterior) return [];
  const previos = new Map(anterior.personajes.map((p) => [p.clave, p]));
  const avisos: Aviso[] = [];
  const fecha = actual.fecha;

  for (const p of actual.personajes) {
    const a = previos.get(p.clave);
    if (!a || p.error || a.error) continue;

    if (ajustes.avisos.subidaNivel && p.nivel > a.nivel) {
      avisos.push({
        fecha, tipo: "nivel", personaje: p.clave,
        texto: { es: `**${p.nombre}** ha llegado al nivel **${p.nivel}**`, en: `**${p.nombre}** reached level **${p.nivel}**` },
      });
    }

    if (ajustes.avisos.piezaObjetivo) {
      const antes = new Set(a.objetivo.conseguidas);
      for (const id of p.objetivo.conseguidas.filter((id) => !antes.has(id))) {
        const pieza = p.equipo.find((x) => x.id === id);
        const n = pieza?.nombre ?? { es: `#${id}`, en: `#${id}` };
        const progreso = `${p.objetivo.conseguidas.length}/${p.objetivo.total}`;
        avisos.push({
          fecha, tipo: "objetivo", personaje: p.clave,
          texto: { es: `**${p.nombre}** ha conseguido **${n.es}** (${progreso})`, en: `**${p.nombre}** obtained **${n.en}** (${progreso})` },
        });
      }
    }

    if (ajustes.avisos.subidaProfesion && p.profesiones && a.profesiones) {
      const umbral = ajustes.avisos.umbralProfesion;
      for (const prof of p.profesiones) {
        const antes = a.profesiones.find((x) => x.nombre.en === prof.nombre.en)?.nivel ?? 0;
        // Avisa al cruzar un múltiplo del umbral (25, 50, 75…) o al llegar al máximo
        const cruza = Math.floor(prof.nivel / umbral) > Math.floor(antes / umbral);
        const alMax = prof.max !== null && prof.nivel === prof.max && antes < prof.max;
        if (cruza || alMax) {
          avisos.push({
            fecha, tipo: "profesion", personaje: p.clave,
            texto: { es: `**${p.nombre}** sube ${prof.nombre.es} a **${prof.nivel}**`, en: `**${p.nombre}** raised ${prof.nombre.en} to **${prof.nivel}**` },
          });
        }
      }
    }
  }
  return avisos;
}

const ICONO: Record<Aviso["tipo"], string> = { nivel: "⬆️", objetivo: "🎯", profesion: "🛠️" };

/** Una tarjeta de Discord por aviso, con el color de la clase y el retrato o icono del personaje */
function tarjetasAvisos(avisos: Aviso[], foto: Foto, ajustes: Ajustes): Embed[] {
  const porClave = new Map(foto.personajes.map((p) => [p.clave, p]));
  const web = urlValida(ajustes.urlWeb);
  return avisos.map((a) => {
    const p = porClave.get(a.personaje);
    const imagen = urlValida(p?.imagen);
    return {
      description: `${ICONO[a.tipo]} ${a.texto[ajustes.idiomaAvisos]}`,
      color: (p?.claseId && COLOR_CLASE[p.claseId]) || COLOR_WFORYOU,
      ...(p ? { author: { name: p.nombre, ...(web ? { url: web } : {}), ...(imagen ? { icon_url: imagen } : {}) } } : {}),
      ...(imagen ? { thumbnail: { url: imagen } } : {}),
      timestamp: a.fecha,
    };
  });
}

// ---------- Programa principal ----------
async function main() {
  const ajustes = await leerJSON<Ajustes | null>("config/ajustes.json", null);
  if (!ajustes) throw new Error("Falta config/ajustes.json");
  const { personajes: lista } = await leerJSON<{ personajes: EntradaConfig[] }>("config/personajes.json", { personajes: [] });

  const get = crearCliente(await pedirToken(), ajustes.region);
  const cache = await leerJSON<CacheObjetos>("datos/objetos.json", {});

  const personajes: Personaje[] = [];
  for (const entrada of lista) {
    if (!entrada.apellido) {
      console.error(`✗ ${entrada.nombre}: falta el apellido. En WoW: Forever cada personaje se identifica por nombre y apellido (config/personajes.json)`);
      continue;
    }
    try {
      const pj = await leerPersonaje(get, ajustes, cache, entrada);
      personajes.push(pj);
      console.log(pj.error ? `✗ ${pj.nombre}: no encontrado en la API (¿nivel 10+ y sesión cerrada?)` : `✓ ${pj.nombre} · nivel ${pj.nivel}`);
    } catch (e) {
      console.error(`✗ ${entrada.nombre}: ${(e as Error).message}`);
    }
  }

  const anterior = await leerJSON<Foto | null>("datos/personajes.json", null);

  // Si todo ha fallado (API caída, namespace incorrecto…), no machacamos los datos buenos.
  // Si aún no hay datos (primera vez), se guardan igualmente para que la web explique qué pasa.
  if (personajes.length === 0 || personajes.every((p) => p.error)) {
    if (anterior?.personajes?.some((p) => !p.error)) {
      throw new Error("No se ha podido leer ningún personaje; se conservan los datos anteriores");
    }
    console.warn("⚠ Ningún personaje encontrado todavía. Recuerda: nivel 10 o más y haber cerrado sesión.");
  }

  const actual: Foto = { fecha: new Date().toISOString(), personajes };

  await mkdir("datos", { recursive: true });
  await escribirJSON("datos/personajes.json", actual);
  // Solo se guardan las fichas de objetos que siguen en uso (equipados u objetivo)
  await escribirJSON("datos/objetos.json", Object.fromEntries(Object.entries(cache).filter(([id]) => usados.has(id))));

  // Personajes que siguen en el grupo y existen: los datos de cualquier otro se eliminan
  const vigentes = new Set(personajes.filter((p) => !p.error).map((p) => p.clave));
  const soloVigentes = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => vigentes.has(k)));

  // Historial compacto para la gráfica de progreso: máximo 30 días y solo personajes vigentes
  const historial = (await leerJSON<any[]>("datos/historial.json", []))
    .filter((h) => !caducado(h.fecha))
    .map((h) => ({ ...h, personajes: soloVigentes(h.personajes) }))
    .filter((h) => Object.keys(h.personajes).length > 0);
  const punto = {
    fecha: actual.fecha,
    personajes: Object.fromEntries(
      personajes
        .filter((p) => !p.error)
        .map((p) => [
          p.clave,
          {
            nivel: p.nivel,
            objetivo: p.objetivo.conseguidas.length,
            profesiones: Object.fromEntries((p.profesiones ?? []).map((x) => [x.nombre.en, x.nivel])),
          },
        ])
    ),
  };
  // Solo guardamos un punto nuevo si algo ha cambiado desde el último (así no crece cada hora sin motivo)
  const ultimo = historial[historial.length - 1];
  if (!ultimo || JSON.stringify(ultimo.personajes) !== JSON.stringify(punto.personajes)) {
    historial.push(punto);
  }
  await escribirJSON("datos/historial.json", historial);

  const avisos = compararFotos(anterior, actual, ajustes);
  console.log(`Avisos: ${avisos.length}`);
  // Registro de avisos para la web: máximo 30 días y solo personajes vigentes
  const registro = (await leerJSON<Aviso[]>("datos/avisos.json", [])).filter((a) => !caducado(a.fecha) && vigentes.has(a.personaje));
  await escribirJSON("datos/avisos.json", [...avisos, ...registro].slice(0, 100));
  await enviarEmbeds(tarjetasAvisos(avisos, actual, ajustes));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
