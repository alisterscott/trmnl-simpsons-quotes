import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

type Character = {
  id: string;
  name: string;
  imageUrl: string;
  imagePageUrl: string;
  quotes: string[];
};

test("character catalog contains extensible records", () => {
  const catalogPath = path.join(__dirname, "..", "src", "characters.json");
  const characters = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as Character[];
  const ids = characters.map((character) => character.id);

  expect(ids).toEqual(expect.arrayContaining(["homer-simpson", "chief-wiggum", "ralph-wiggum"]));
  expect(new Set(ids).size).toBe(ids.length);

  for (const character of characters) {
    expect(character.id).toBeTruthy();
    expect(character.name).toBeTruthy();
    expect(character.imageUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    expect(character.imagePageUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/File:/);
    expect(Array.isArray(character.quotes)).toBe(true);
  }
});
