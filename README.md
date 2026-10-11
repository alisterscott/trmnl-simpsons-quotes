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
`src/settings.yml`. The quote renderer must apply the selected IDs when it
chooses a quote.

## Quote layout

All widget sizes use the shared layout in
[`src/shared.liquid`](./src/shared.liquid). It keeps the quote and character
image side by side in landscape, with an approximately 80/20 split, and stacks
them in portrait. The Framework 3.4 content limiter reduces quote typography
for smaller view areas; exceptionally long quotes may be clamped if they still
do not fit.

The local preview and Playwright tests use sample values from `.trmnlp.yml`.
These are preview fixtures, not quote-selection logic or deployed plugin data.

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
