import fs from "fs";
import path from "path";

export type Character = {
  id: string;
  name: string;
  imageUrl: string;
  imagePageUrl: string;
  quotes: string[];
};

/** The editable catalog in src/characters.json (the source of truth). */
export const characters = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "characters.json"),
    "utf-8",
  ),
) as Character[];

export const allQuotes = characters.flatMap((character) => character.quotes);

export function findCharacter(id: string): Character {
  const character = characters.find((candidate) => candidate.id === id);
  if (!character) {
    throw new Error(`${id} is missing from the character catalog`);
  }
  return character;
}

export function longestQuote(quotes: string[]): string {
  return quotes.reduce((longest, quote) =>
    quote.length > longest.length ? quote : longest,
  );
}
