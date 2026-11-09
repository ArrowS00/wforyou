/**
 * WForYou · comprobar la API de WoW: Forever
 * La API de Forever funciona pero Blizzard no la ha documentado: este script comprueba qué responde
 * con tus credenciales, y si le das un personaje, qué datos de él se pueden leer.
 *
 * Variables: BNET_CLIENT_ID, BNET_CLIENT_SECRET (secrets) · NOMBRE, APELLIDO (opcionales)
 */
import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const ajustes = existsSync("config/ajustes.json") ? JSON.parse(await readFile("config/ajustes.json", "utf8")) : {};
const region: string = (ajustes.region || "eu").toLowerCase();
const nsProfile: string = ajustes.namespaceProfile || `profile-forever-${region}`;
const nsStatic: string = ajustes.namespaceStatic || `static-forever-${region}`;
const nsDynamic = nsProfile.replace(/^profile-/, "dynamic-");
const nombre = (process.env.NOMBRE ?? "").trim();
const apellido = (process.env.APELLIDO ?? "").trim();

async function token(): Promise<string> {
  const id = process.env.BNET_CLIENT_ID, sec = process.env.BNET_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Faltan BNET_CLIENT_ID / BNET_CLIENT_SECRET");
  const r = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`Token: HTTP ${r.status} (revisa el client_id y el client_secret)`);
  return ((await r.json()) as any).access_token;
}
const tk = await token();
const get = async (ruta: string, ns: string) => {
  const r = await fetch(`https://${region}.api.blizzard.com${ruta}?namespace=${encodeURIComponent(ns)}&locale=es_ES`, { headers: { Authorization: `Bearer ${tk}` } });
  return { status: r.status, json: r.ok ? ((await r.json()) as any) : null };
};

type Fila = { prueba: string; ok: boolean; detalle: string };
const filas: Fila[] = [];
const anota = (prueba: string, ok: boolean, detalle: string) => filas.push({ prueba, ok, detalle });

// Datos del juego (static)
const razas = await get("/data/wow/playable-race/index", nsStatic);
const skyborne = (razas.json?.races ?? []).some((x: any) => /skyborne|celest/i.test(x.name ?? ""));
anota(`Razas (${nsStatic})`, razas.status === 200, razas.status === 200 ? `${razas.json.races.length} razas${skyborne ? ", incluida Skyborne ✓" : ""}` : `HTTP ${razas.status}`);
const clases = await get("/data/wow/playable-class/index", nsStatic);
anota(`Clases (${nsStatic})`, clases.status === 200, clases.status === 200 ? `${clases.json.classes.length} clases` : `HTTP ${clases.status}`);

// Servidores (dynamic): en Forever hay "rulesets" en vez de reinos
const rulesets = await get("/data/wow/ruleset/index", nsDynamic);
const lista = (rulesets.json?.rulesets ?? []).map((x: any) => x.name).join(", ");
anota(`Tipos de servidor (${nsDynamic})`, rulesets.status === 200, rulesets.status === 200 ? lista || "respuesta vacía" : `HTTP ${rulesets.status}`);

// Personaje (profile)
if (nombre && apellido) {
  const base = `/profile/wow/character/${encodeURIComponent(`${nombre}-${apellido}`.toLowerCase())}`;
  const perfil = await get(base, nsProfile);
  anota(`Personaje ${nombre} ${apellido}`, perfil.status === 200,
    perfil.status === 200 ? `nivel ${perfil.json.level} · ${perfil.json.character_class?.name ?? "?"} · ${perfil.json.ruleset?.name ?? ""}` :
    perfil.status === 404 ? "no encontrado: tiene que ser nivel 10 o más y haber cerrado sesión al menos una vez" : `HTTP ${perfil.status}`);
  if (perfil.status === 200) {
    for (const [sub, desc] of [["equipment", "Equipo"], ["professions", "Profesiones"], ["specializations", "Especializaciones"], ["character-media", "Retrato"]] as const) {
      const r = await get(`${base}/${sub}`, nsProfile);
      let detalle = r.status === 200 ? "disponible" : `HTTP ${r.status}`;
      if (sub === "equipment" && r.json) detalle = `${r.json.equipped_items?.length ?? 0} piezas`;
      if (sub === "professions" && r.json) detalle = [...(r.json.primaries ?? []), ...(r.json.secondaries ?? [])].map((p: any) => p.profession?.name).join(", ") || "sin profesiones";
      if (sub === "character-media" && r.status === 404) detalle = "aún no generado (puede tardar horas tras aparecer el personaje)";
      if (sub === "specializations" && r.json) {
        const activa = r.json.active_specialization?.name;
        detalle = activa ? `activa: ${activa}` : "responde, pero sin especialización activa (se usará la de config/personajes.json)";
      }
      anota(`  ${desc}`, r.status === 200, detalle);
    }
    if (!perfil.json.active_spec) anota("  Especialización en el perfil", false, "no viene (normal en Forever por ahora)");
  }
} else {
  anota("Personaje", false, "no indicado: rellena nombre y apellido para comprobar uno");
}

const texto = filas.map((f) => `${f.ok ? "✓" : "✗"} ${f.prueba}: ${f.detalle}`).join("\n");
console.log(`\nRegión ${region} · profile: ${nsProfile} · static: ${nsStatic}\n\n${texto}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Comprobación de la API de WoW: Forever\n\n| | Prueba | Resultado |\n|---|---|---|\n${filas.map((f) => `| ${f.ok ? "✅" : "❌"} | ${f.prueba.trim()} | ${f.detalle} |`).join("\n")}\n`);
}
