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

  expect(ids).toEqual(
    expect.arrayContaining([
      "homer-simpson",
      "marge-simpson",
      "chief-wiggum",
      "ralph-wiggum",
    ]),
  );
  expect(new Set(ids).size).toBe(ids.length);

  for (const character of characters) {
    expect(character.id).toBeTruthy();
    expect(character.name).toBeTruthy();
    expect(character.imageUrl).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    expect(character.imagePageUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/File:/);
    expect(Array.isArray(character.quotes)).toBe(true);
  }
});

test("host static data matches the editable character catalog", () => {
  const projectRoot = path.join(__dirname, "..");
  const staticDataScript = `
    require 'yaml'
    require 'json'
    settings = YAML.load_file('src/settings.yml')
    abort 'quote data requires static strategy' unless settings.fetch('strategy') == 'static'
    fields = settings.fetch('custom_fields').find { |field| field.fetch('keyname') == 'character_ids' }
    options = fields.fetch('options').flat_map(&:to_a).to_h
    author = settings.fetch('custom_fields').find { |field| field.fetch('keyname') == 'about' }
    puts JSON.generate({
      characters: JSON.parse(settings.fetch('static_data')).fetch('characters'),
      options: options,
      author_email: author.fetch('email_address')
    })
  `;

  const pluginData = JSON.parse(
    execFileSync("bundle", ["exec", "ruby", "-e", staticDataScript], {
      cwd: projectRoot,
      encoding: "utf-8",
    }),
  ) as { characters: Character[]; options: Record<string, string>; author_email: string };

  expect(pluginData.characters).toEqual(
    characters.map(({ id, name, imageUrl, quotes }) => ({ id, name, imageUrl, quotes })),
  );
  expect(pluginData.options).toHaveProperty("Marge Simpson", "marge-simpson");
  expect(pluginData.author_email).toBe("alister.scott@gmail.com");
});

test("native Liquid quote selection respects character filters", () => {
  const projectRoot = path.join(__dirname, "..");
  const renderScript = `
    require 'trmnlp'
    require 'json'
    context = TRMNLP::Context.new(Dir.pwd)
    data = context.user_data
    data['trmnl']['plugin_settings']['custom_fields_values']['character_ids'] = ARGV.fetch(0)
    template = Liquid::Template.parse(
      File.read('src/shared.liquid') + File.read('src/full.liquid'),
      environment: TRMNL::Liquid.build_environment
    )
    puts template.render(data)
  `;

  for (const [selectedIds, allowedIds] of [
    ["homer-simpson", ["homer-simpson"]],
    ["marge-simpson", ["marge-simpson"]],
    ['["marge-simpson"]', ["marge-simpson"]],
    ["chief-wiggum", ["chief-wiggum"]],
    ["ralph-wiggum", ["ralph-wiggum"]],
    ["chief-wiggum,ralph-wiggum", ["chief-wiggum", "ralph-wiggum"]],
    ['["chief-wiggum", "ralph-wiggum"]', ["chief-wiggum", "ralph-wiggum"]],
    ["", characters.map((character) => character.id)],
  ] as const) {
    const rendered = execFileSync(
      "bundle",
      ["exec", "ruby", "-e", renderScript, selectedIds],
      { cwd: projectRoot, encoding: "utf-8" },
    );
    const selectedCharacter = characters.find((character) =>
      rendered.includes(`alt="${character.name}"`),
    );

    expect(selectedCharacter).toBeDefined();
    if (!selectedCharacter) {
      throw new Error("Liquid did not render a character image");
    }
    expect(allowedIds).toContain(selectedCharacter.id);
    expect(rendered).toContain(selectedCharacter.imageUrl);
  }
});
