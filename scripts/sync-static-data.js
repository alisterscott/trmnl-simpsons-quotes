const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const charactersPath = path.join(root, "src", "characters.json");
const settingsPath = path.join(root, "src", "settings.yml");

const characters = JSON.parse(fs.readFileSync(charactersPath, "utf8"));
if (!Array.isArray(characters)) {
  throw new Error(`${charactersPath} must contain an array`);
}

const staticCharacters = characters.map(({ id, name, imageUrl, quotes }) => {
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof imageUrl !== "string" ||
    !Array.isArray(quotes) ||
    !quotes.every((quote) => typeof quote === "string")
  ) {
    throw new Error(`Character ${JSON.stringify(id)} has invalid static data`);
  }

  return { id, name, imageUrl, quotes };
});

const settings = fs.readFileSync(settingsPath, "utf8");
const staticDataLines = settings.match(/^static_data:.*$/gm) ?? [];
if (staticDataLines.length !== 1) {
  throw new Error(`Expected exactly one static_data entry in ${settingsPath}`);
}

const staticData = JSON.stringify({ characters: staticCharacters });
const yamlQuotedStaticData = staticData.replace(/'/g, "''");
const updatedSettings = settings.replace(
  /^static_data:.*$/m,
  `static_data: '${yamlQuotedStaticData}'`,
);

fs.writeFileSync(settingsPath, updatedSettings);
console.log(`Synchronized ${staticCharacters.length} characters to src/settings.yml`);
