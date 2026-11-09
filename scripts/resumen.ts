/**
 * WForYou · resumen semanal para Discord
 * Compara la última foto del historial con la de hace 7 días y envía una tarjeta por Discord.
 * No llama a la API de Blizzard: solo lee datos/ y necesita DISCORD_WEBHOOK_URL.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { COLOR_WFORYOU, PIE_FUENTE, enviarEmbeds, urlValida, type Embed } from "./discord.js";

type Punto = { fecha: string; personajes: Record<string, { nivel: number; objetivo: number; profesiones: Record<string, number> }> };

const leer = async <T>(ruta: string, porDefecto: T): Promise<T> =>
  existsSync(ruta) ? (JSON.parse(await readFile(ruta, "utf8")) as T) : porDefecto;

const ajustes = await leer<any>("config/ajustes.json", {});
if (ajustes.avisos?.resumenSemanal === false) {
  console.log("Resumen semanal desactivado en config/ajustes.json");
  process.exit(0);
}
const es = (ajustes.idiomaAvisos ?? "es") === "es";
const historial = await leer<Punto[]>("datos/historial.json", []);
const datos = await leer<any>("datos/personajes.json", { personajes: [] });
if (historial.length === 0) {
  console.log("Sin historial todavía; no se envía resumen");
  process.exit(0);
}

const fin = historial[historial.length - 1];
const limite = new Date(fin.fecha).getTime() - 7 * 24 * 3600 * 1000;
// El punto de partida es la última foto anterior a hace 7 días (o la primera si el grupo es más nuevo)
const inicio = [...historial].reverse().find((p) => new Date(p.fecha).getTime() <= limite) ?? historial[0];

const suma = (o: Record<string, number> = {}) => Object.values(o).reduce((a, b) => a + b, 0);
const filas = (datos.personajes as any[])
  .filter((p) => !p.error && fin.personajes[p.clave])
  .map((p) => {
    const a = inicio.personajes[p.clave] ?? { nivel: p.nivel, objetivo: 0, profesiones: {} };
    const b = fin.personajes[p.clave];
    return {
      p,
      niveles: b.nivel - a.nivel,
      nivelA: a.nivel,
      nivelB: b.nivel,
      piezas: b.objetivo - a.objetivo,
      puntosProf: suma(b.profesiones) - suma(a.profesiones),
    };
  })
  .sort((x, y) => y.niveles - x.niveles || y.piezas - x.piezas);

const fecha = (iso: string) => new Date(iso).toLocaleDateString(es ? "es-ES" : "en-GB", { day: "numeric", month: "short" });
const hayCambios = filas.some((f) => f.niveles || f.piezas || f.puntosProf);
const lider = filas[0] && filas[0].niveles > 0 ? filas[0] : null;

const descripcion = !hayCambios
  ? es ? "Semana tranquila: nadie ha avanzado desde el último resumen." : "Quiet week: nobody has progressed since the last summary."
  : lider
  ? es ? `🏆 Quien más ha subido: **${lider.p.nombre}** (+${lider.niveles} niveles)` : `🏆 Most levels gained: **${lider.p.nombre}** (+${lider.niveles} levels)`
  : es ? "Nadie ha subido de nivel, pero ha habido progreso:" : "No level ups, but there was progress:";

const embed: Embed = {
  title: es ? `Resumen semanal · ${fecha(inicio.fecha)} – ${fecha(fin.fecha)}` : `Weekly summary · ${fecha(inicio.fecha)} – ${fecha(fin.fecha)}`,
  ...(urlValida(ajustes.urlWeb) ? { url: ajustes.urlWeb } : {}),
  description: descripcion,
  color: COLOR_WFORYOU,
  fields: filas.slice(0, 25).map((f) => {
    const objetivo = f.p.objetivo?.total ? ` (${f.p.objetivo.conseguidas.length}/${f.p.objetivo.total})` : "";
    const lineas = [
      es ? `Nivel ${f.nivelA} → ${f.nivelB}${f.niveles ? ` (+${f.niveles})` : ""}` : `Level ${f.nivelA} → ${f.nivelB}${f.niveles ? ` (+${f.niveles})` : ""}`,
      es ? `Piezas objetivo: ${f.piezas >= 0 ? "+" : ""}${f.piezas}${objetivo}` : `Target items: ${f.piezas >= 0 ? "+" : ""}${f.piezas}${objetivo}`,
      es ? `Profesiones: +${Math.max(0, f.puntosProf)} puntos` : `Professions: +${Math.max(0, f.puntosProf)} points`,
    ];
    return { name: f.p.nombre, value: lineas.join("\n"), inline: true };
  }),
  footer: { text: PIE_FUENTE },
  timestamp: fin.fecha,
};

await enviarEmbeds([embed]);
console.log(hayCambios ? `Resumen enviado (${filas.length} personajes)` : "Resumen enviado (semana sin cambios)");
