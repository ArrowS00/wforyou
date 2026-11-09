/**
 * WForYou · añadir amigo (lo lanza el workflow "Añadir amigo", solo para el admin)
 * Uso: tsx scripts/anadir-amigo.ts "<nombre>" "<apellido>" ["<lista-objetivo>"]
 * En WoW: Forever no hay reinos: cada personaje es único por nombre y apellido en su región.
 */
import { readFile, writeFile } from "node:fs/promises";

const [nombre, apellido, objetivo] = process.argv.slice(2).map((s) => s?.trim());
if (!nombre || !apellido) {
  console.error("Uso: anadir-amigo <nombre> <apellido> [lista-objetivo]");
  process.exit(1);
}
for (const [campo, valor] of [["Nombre", nombre], ["Apellido", apellido]] as const) {
  if (!/^[\p{L}]{2,24}$/u.test(valor)) {
    console.error(`${campo} no válido: "${valor}" (solo letras, de 2 a 24)`);
    process.exit(1);
  }
}
if (objetivo && !/^[a-z0-9-]+$/.test(objetivo)) {
  console.error(`Lista objetivo no válida: "${objetivo}" (ejemplo: warrior-protection)`);
  process.exit(1);
}

const ruta = "config/personajes.json";
const config = JSON.parse(await readFile(ruta, "utf8")) as {
  personajes: { nombre: string; apellido: string; objetivo?: string }[];
};

const clave = (n: string, a: string) => `${n}-${a}`.toLowerCase();
if (config.personajes.some((p) => clave(p.nombre, p.apellido ?? "") === clave(nombre, apellido))) {
  console.log(`${nombre} ${apellido} ya estaba en el grupo; no se cambia nada.`);
  process.exit(0);
}

config.personajes.push(objetivo ? { nombre, apellido, objetivo } : { nombre, apellido });
await writeFile(ruta, JSON.stringify(config, null, 2) + "\n", "utf8");
console.log(`Añadido ${nombre} ${apellido}. Ahora sois ${config.personajes.length}.`);
