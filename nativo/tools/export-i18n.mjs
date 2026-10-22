// Exporta o dicionário português → inglês (src/game/i18n.en.js) para a versão nativa.
// Uso: node nativo/tools/export-i18n.mjs  →  nativo/assets/i18n/en.json
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { EN, EN_HTML } = await import(resolve(root, 'src/game/i18n.en.js'));
const file = resolve(root, 'nativo/assets/i18n/en.json');
// os blocos com marcação (data-i18n) vão como "#html:<id>", sem as marcas
const html = Object.fromEntries(Object.entries(EN_HTML).map(([k, v]) => [`#html:${k}`, v.replace(/<[^>]+>/g, '')]));
writeFileSync(file, JSON.stringify({ ...Object.fromEntries(EN), ...html }));
console.log(`${EN.size} textos → ${file}`);
