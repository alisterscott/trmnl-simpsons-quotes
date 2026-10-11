import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

type Character = {
  id: string;
  name: string;
  imageUrl: string;
  imagePageUrl: string;
  quotes: string[];
};

const catalogPath = path.join(__dirname, "..", "src", "characters.json");
const characters = JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as Character[];

test("character catalog contains extensible records", () => {
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

test("random quote selection respects character filters", () => {
  const projectRoot = path.join(__dirname, "..");
  const filterScript = `
    require 'simpsons_quotes_filters'
    require 'json'
    filter = Object.new.extend(SimpsonsQuotesFilters)
    puts JSON.generate(filter.random_simpsons_quote('', JSON.parse(ARGV.fetch(0))))
  `;

  for (const selectedIds of [
    ["homer-simpson"],
    ["chief-wiggum"],
    ["ralph-wiggum"],
    ["chief-wiggum", "ralph-wiggum"],
    "chief-wiggum,ralph-wiggum",
    [],
  ]) {
    const selectedQuote = JSON.parse(
      execFileSync(
        "bundle",
        ["exec", "ruby", "-Isrc", "-e", filterScript, JSON.stringify(selectedIds)],
        { cwd: projectRoot, encoding: "utf-8" },
      ),
    );

    const character = characters.find(
      (candidate: Character) => candidate.id === selectedQuote.character.id,
    );
    expect(character).toBeDefined();
    if (!character) {
      throw new Error(`Character ${selectedQuote.character.id} is not in the catalog`);
    }
    expect(character.quotes).toContain(selectedQuote.text);
    if (selectedIds.length > 0) {
      const allowedIds = Array.isArray(selectedIds) ? selectedIds : selectedIds.split(",");
      expect(allowedIds).toContain(selectedQuote.character.id);
    }
  }
});
