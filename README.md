# Simpsons Quotes TRMNL plugin

A TRMNL plugin for displaying Simpsons quotes. The local preview is powered by
[`trmnl_preview`](https://github.com/usetrmnl/trmnl_preview), and the browser
tests use Playwright.

## Requirements

- Git
- Ruby **3.4.8** (the version in `.ruby-version`)
- Bundler **2.6.9**
- Node.js LTS and npm
- A Playwright-supported browser (Chromium)

## Set up Ruby with rbenv

If you don't already have Ruby 3.4.8, install `rbenv` and its Ruby build plugin.
On macOS with Homebrew:

```sh
brew install rbenv ruby-build
```

Initialize rbenv for your shell (for zsh, add this to `~/.zshrc`):

```sh
eval "$(rbenv init - zsh)"
```

Restart your shell, then from the repository root install and select the
project's Ruby version:

```sh
rbenv install 3.4.8
rbenv local 3.4.8
ruby --version
```

The `rbenv local` command writes `.ruby-version`, which is already set to
`3.4.8` in this repository. If that file exists, rbenv selects the version
automatically when you enter the project directory.

For other operating systems, install rbenv and ruby-build using their
[installation instructions](https://github.com/rbenv/rbenv#installation), then
run the same `rbenv install` command.

## Install Ruby gems

Install the Bundler version recorded in `Gemfile.lock`, then install the
project's gems:

```sh
gem install bundler -v 2.6.9
rbenv rehash
bundle install
```

`bundle install` installs the `trmnl_preview` gem used to serve the plugin
preview.

## Install Node packages and Playwright

Install Node.js LTS if it isn't already available, then install the locked npm
dependencies and Playwright's Chromium browser:

```sh
npm ci
npx playwright install chromium
```

On Linux, install the browser's system dependencies as well:

```sh
npx playwright install --with-deps chromium
```

## Run the local TRMNL preview

From the repository root, start the preview server:

```sh
bundle exec trmnlp serve
```

Open [http://localhost:4567](http://localhost:4567). The preview serves each
widget view at its route:

- `/full`
- `/half_horizontal`
- `/half_vertical`
- `/quadrant`

The server watches `.trmnlp.yml` and `src` for changes. Stop it with `Ctrl+C`.

## Character selection

The **Characters** custom field is an optional multi-select setting defined in
[`src/settings.yml`](./src/settings.yml). Select one or more characters to
choose which characters may contribute quotes; leave it empty to include all
characters. The setting uses character IDs from
[`src/characters.json`](./src/characters.json), rather than display names.

To add a character to the setting, add its record to `src/characters.json` and
add a matching `Name: character-id` option under `custom_fields` in
`src/settings.yml`. Also add that character's `id`, `name`, `imageUrl`, and
`quotes` to the `static_data` JSON in the same settings file. The Playwright
suite checks that the static data stays synchronized with the character
catalog. The static data is required because hosted TRMNL rendering cannot
load the local JSON file or the preview-only Ruby filters.

During rendering, native Liquid selects a random quote from the selected
characters' quote pool. With no selections, all characters with quotes are
eligible. The selection is recalculated on each render.

Hans Moleman is available as a character option. Wikipedia does not have a
standalone Hans Moleman image, so his artwork currently links to Wikisimpsons.

## Quote layout

All four required views use the shared template in
[`src/shared.liquid`](./src/shared.liquid); the view-specific Liquid files
remain as minimal placeholders. The shared layout keeps the quote and
character image side by side in landscape, with an approximately 80/20 split
(75/25 on larger screens), and stacks them in portrait. In portrait, the quote
and author are vertically centered in the upper section while the larger lower
section gives the character image more room. Framework 3.4's content limiter
reduces quote typography for smaller view areas, and responsive line clamps
keep long quotes from overlapping the character name. The quote and
attribution scale up on large screens, and the attribution sits at the bottom
of its column to balance short quotes. Portrait clamp limits leave room for
the author. A small left inset protects the opening characters from device
font-rendering differences. Character artwork keeps its aspect ratio, has
descriptive alt text, and uses Framework's `image-dither` utility so it can be
adapted to limited-palette displays while retaining color on color-capable
devices.

The local preview and Playwright tests use `.trmnlp.yml` for their selected
character values. The same static quote data is used by the hosted renderer
and the local preview. To preview a selection locally, set the custom field
in `.trmnlp.yml`; omit it or leave it empty to include all characters:

```yaml
custom_fields:
  character_ids: homer-simpson,ralph-wiggum
```

## Run the tests

Playwright starts the TRMNL preview server automatically when needed:

```sh
npm test
```

To run a specific test by title:

```sh
npm test -- --grep "character catalog"
```

The HTML report is generated in `playwright-report/`.
