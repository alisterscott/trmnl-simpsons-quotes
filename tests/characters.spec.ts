import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import path from "path";
import { characters, type Character } from "./support/catalog";

const projectRoot = path.join(__dirname, "..");

test("character catalog contains extensible records", () => {
  const ids = characters.map((character) => character.id);

  expect(ids).toEqual(
    expect.arrayContaining([
      "bart-simpson",
      "homer-simpson",
      "marge-simpson",
      "chief-wiggum",
      "ralph-wiggum",
      "hans-moleman",
      "cletus-spuckler",
      "lisa-simpson",
      "mr-burns",
      "ned-flanders",
      "principal-skinner",
      "comic-book-guy",
      "moe-szyslak",
      "krusty-the-clown",
      "milhouse-van-houten",
      "grampa-simpson",
      "professor-frink",
      "troy-mcclure",
    ]),
  );
  expect(new Set(ids).size).toBe(ids.length);

  for (const character of characters) {
    expect(character.id).toBeTruthy();
    expect(character.name).toBeTruthy();
    expect(character.imageUrl).toMatch(
      /^https:\/\/(?:upload\.wikimedia\.org|static\.simpsonswiki\.com)\//,
    );
    expect(character.imagePageUrl).toMatch(
      /^https:\/\/(?:en\.wikipedia\.org\/wiki\/File:|simpsonswiki\.com\/wiki\/File:)/,
    );
    expect(Array.isArray(character.quotes)).toBe(true);
  }
});

test("host static data matches the editable character catalog", () => {
  const staticDataScript = `
    require 'yaml'
    require 'json'
    settings = YAML.load_file('src/settings.yml')
    abort 'quote data requires static strategy' unless settings.fetch('strategy') == 'static'
    fields = settings.fetch('custom_fields').find { |field| field.fetch('keyname') == 'character_ids' }
    options = fields.fetch('options').flat_map(&:to_a).to_h
    author = settings.fetch('custom_fields').find { |field| field.fetch('keyname') == 'about' }
    randomise = settings.fetch('custom_fields').find { |field| field.fetch('keyname') == 'randomise_characters' }
    puts JSON.generate({
      characters: JSON.parse(settings.fetch('static_data')).fetch('characters'),
      options: options,
      author_email: author.fetch('email_address'),
      randomise: {
        default: randomise.fetch('default'),
        field_type: randomise.fetch('field_type'),
        options: randomise.fetch('options').flat_map(&:to_a).to_h
      }
    })
  `;

  const pluginData = JSON.parse(
    execFileSync("bundle", ["exec", "ruby", "-e", staticDataScript], {
      cwd: projectRoot,
      encoding: "utf-8",
    }),
  ) as {
    characters: Character[];
    options: Record<string, string>;
    author_email: string;
    randomise: { default: string; field_type: string; options: Record<string, string> };
  };

  expect(pluginData.characters).toEqual(
    characters.map(({ id, name, imageUrl, quotes }) => ({ id, name, imageUrl, quotes })),
  );
  expect(pluginData.options).toHaveProperty("Marge Simpson", "marge-simpson");
  expect(pluginData.options).toHaveProperty("Bart Simpson", "bart-simpson");
  expect(pluginData.options).toHaveProperty("Hans Moleman", "hans-moleman");
  expect(pluginData.options).toHaveProperty("Cletus Spuckler", "cletus-spuckler");
  expect(pluginData.options).toHaveProperty("Lisa Simpson", "lisa-simpson");
  // an array path, because "Mr. Burns" contains a dot
  expect(pluginData.options).toHaveProperty(["Mr. Burns"], "mr-burns");
  expect(pluginData.options).toHaveProperty("Ned Flanders", "ned-flanders");
  expect(pluginData.options).toHaveProperty("Principal Skinner", "principal-skinner");
  expect(pluginData.options).toHaveProperty("Comic Book Guy", "comic-book-guy");
  expect(pluginData.options).toHaveProperty("Moe Szyslak", "moe-szyslak");
  expect(pluginData.options).toHaveProperty("Krusty the Clown", "krusty-the-clown");
  expect(pluginData.options).toHaveProperty("Milhouse Van Houten", "milhouse-van-houten");
  expect(pluginData.options).toHaveProperty("Grampa Simpson", "grampa-simpson");
  expect(pluginData.options).toHaveProperty("Professor Frink", "professor-frink");
  expect(pluginData.options).toHaveProperty("Troy McClure", "troy-mcclure");
  // TRMNL has no checkbox field, so "Randomise characters" is a Yes/No select
  // that defaults to Yes
  expect(pluginData.randomise).toEqual({
    default: "yes",
    field_type: "select",
    options: { Yes: "yes", No: "no" },
  });
  expect(pluginData.author_email).toBe("alister.scott@gmail.com");
});

test("native Liquid quote selection respects character filters", () => {
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
    ["bart-simpson", ["bart-simpson"]],
    ["homer-simpson", ["homer-simpson"]],
    ["marge-simpson", ["marge-simpson"]],
    ['["marge-simpson"]', ["marge-simpson"]],
    ["chief-wiggum", ["chief-wiggum"]],
    ["ralph-wiggum", ["ralph-wiggum"]],
    ["hans-moleman", ["hans-moleman"]],
    ["cletus-spuckler", ["cletus-spuckler"]],
    ["lisa-simpson", ["lisa-simpson"]],
    ["mr-burns,ned-flanders", ["mr-burns", "ned-flanders"]],
    ["principal-skinner", ["principal-skinner"]],
    ["comic-book-guy", ["comic-book-guy"]],
    ["moe-szyslak", ["moe-szyslak"]],
    ["professor-frink,troy-mcclure", ["professor-frink", "troy-mcclure"]],
    ["chief-wiggum,ralph-wiggum", ["chief-wiggum", "ralph-wiggum"]],
    ["ralph-wiggum,hans-moleman", ["ralph-wiggum", "hans-moleman"]],
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

test("randomise characters picks characters evenly unless it is turned off", () => {
  const renderScript = `
    require 'trmnlp'
    require 'json'
    context = TRMNLP::Context.new(Dir.pwd)
    base = context.user_data
    template = Liquid::Template.parse(
      File.read('src/shared.liquid') + File.read('src/full.liquid'),
      environment: TRMNL::Liquid.build_environment
    )
    names = JSON.parse(File.read('src/characters.json')).map { |c| c['name'] }

    # Renders at the plugin's real 900 second refresh interval. Plain
    # "seconds mod N" would pick the same character every time.
    tally = lambda do |ids, randomise, count|
      counts = Hash.new(0)
      count.times do |i|
        Time.define_singleton_method(:now) { Time.at(1_763_800_000 + i * 900) }
        data = Marshal.load(Marshal.dump(base))
        values = data['trmnl']['plugin_settings']['custom_fields_values']
        values['character_ids'] = ids
        values['randomise_characters'] = randomise unless randomise.nil?
        out = template.render(data)
        counts[names.find { |name| out.include?(%(alt="#{name}")) }] += 1
      end
      counts.transform_values { |n| (100.0 * n / count).round(1) }
    end

    two = 'homer-simpson,cletus-spuckler'
    puts JSON.generate({
      all_default: tally.call('', nil, 900),
      all_yes: tally.call('', 'yes', 300),
      two_default: tally.call(two, nil, 600),
      two_no: tally.call(two, 'no', 600),
      all_no: tally.call('', 'no', 900)
    })
  `;
  const shares = JSON.parse(
    execFileSync("bundle", ["exec", "ruby", "-e", renderScript], {
      cwd: projectRoot,
      encoding: "utf-8",
    }),
  ) as Record<string, Record<string, number>>;

  // Default (setting not set) and "yes": every character is equally likely
  const even = 100 / characters.length;
  for (const key of ["all_default", "all_yes"]) {
    expect(Object.keys(shares[key]).sort()).toEqual(
      characters.map((c) => c.name).sort(),
    );
    for (const share of Object.values(shares[key])) {
      expect(share).toBeGreaterThan(even * 0.5);
      expect(share).toBeLessThan(even * 1.6);
    }
  }
  // Homer has 51 quotes and Cletus 6, but they come up about equally often
  expect(shares.two_default["Homer Simpson"]).toBeGreaterThan(40);
  expect(shares.two_default["Homer Simpson"]).toBeLessThan(60);
  // "no" picks any quote at random, so the character with more quotes wins
  expect(shares.two_no["Homer Simpson"]).toBeGreaterThan(80);
  expect(shares.all_no["Homer Simpson"]).toBeGreaterThan(15);
});
