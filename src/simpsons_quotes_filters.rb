require 'json'

module SimpsonsQuotesFilters
  def random_simpsons_quote(_input, selected_character_ids = nil)
    selected_ids = normalize_character_ids(selected_character_ids)
    characters = JSON.parse(File.read(File.join(__dir__, 'characters.json')))
    eligible_characters = if selected_ids.empty?
                            characters
                          else
                            characters.select { |character| selected_ids.include?(character.fetch('id')) }
                          end

    quote_pool = eligible_characters.flat_map do |character|
      character.fetch('quotes', []).map do |quote|
        { 'text' => quote, 'character' => character }
      end
    end

    raise ArgumentError, 'No quotes available for the selected characters' if quote_pool.empty?

    quote_pool.sample
  end

  private

  def normalize_character_ids(value)
    ids = case value
          when Array
            value
          when String
            stripped_value = value.strip
            return [] if stripped_value.empty?

            if stripped_value.start_with?('[')
              parsed_value = JSON.parse(stripped_value)
              parsed_value.is_a?(Array) ? parsed_value : [stripped_value]
            else
              stripped_value.split(',')
            end
          when nil
            []
          else
            [value]
          end

    ids.map(&:to_s).map(&:strip).reject(&:empty?).uniq
  rescue JSON::ParserError
    value.split(',').map(&:strip).reject(&:empty?).uniq
  end
end
