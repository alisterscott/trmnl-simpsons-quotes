// Copies the character catalog (src/characters.json, the source of truth) into
// the single-line `static_data` entry of src/settings.yml, which is what the
// hosted TRMNL renderer reads. Everything else in settings.yml is left alone.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CHARACTERS_PATH = path.join(ROOT, "src", "characters.json");
const SETTINGS_PATH = path.join(ROOT, "src", "settings.yml");
const STATIC_DATA_LINE = /^static_data:.*$/gm;

function readCharacters() {
  const characters = JSON.parse(fs.readFileSync(CHARACTERS_PATH, "utf8"));
  if (!Array.isArray(characters)) {
    throw new Error(`${CHARACTERS_PATH} must contain an array`);
  }
  return characters;
}

// Keeps only the fields the hosted renderer needs (e.g. drops imagePageUrl).
function toStaticCharacter({ id, name, imageUrl, quotes }) {
  const isValid =
    typeof id === "string" &&
    typeof name === "string" &&
    typeof imageUrl === "string" &&
    Array.isArray(quotes) &&
    quotes.every((quote) => typeof quote === "string");
  if (!isValid) {
    throw new Error(`Character ${JSON.stringify(id)} has invalid static data`);
  }
  return { id, name, imageUrl, quotes };
}

function toYamlSingleQuoted(text) {
  return `'${text.replace(/'/g, "''")}'`;
}

function replaceStaticData(settings, characters) {
  const matches = settings.match(STATIC_DATA_LINE) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one static_data entry in ${SETTINGS_PATH}`);
  }
  const line = `static_data: ${toYamlSingleQuoted(JSON.stringify({ characters }))}`;
  // A replacer function keeps `$` sequences in quotes from being treated as
  // replacement patterns.
  return settings.replace(STATIC_DATA_LINE, () => line);
}

const characters = readCharacters().map(toStaticCharacter);
const settings = fs.readFileSync(SETTINGS_PATH, "utf8");
fs.writeFileSync(SETTINGS_PATH, replaceStaticData(settings, characters));
console.log(`Synchronized ${characters.length} characters to src/settings.yml`);
