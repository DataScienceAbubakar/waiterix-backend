import { generateTextWithClaude } from './bedrock';

const languageNames: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  zh: 'Chinese',
  ja: 'Japanese',
  ar: 'Arabic',
  pt: 'Portuguese',
  ru: 'Russian',
};

/**
 * Translation Service for menu items using Claude 3.5 via AWS Bedrock
 */
export class TranslationService {
  constructor() {
    // No API key needed - using AWS credentials
  }

  /**
   * Translate menu item name and description to target language
   * 
   * @param name - Menu item name in source language
   * @param description - Menu item description in source language
   * @param sourceLanguage - Source language code (e.g., 'en')
   * @param targetLanguage - Target language code (e.g., 'es')
   * @returns Object with translated name and description
   */
  async translateMenuItem(
    name: string,
    description: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<{ name: string; description: string }> {
    const sourceLangName = languageNames[sourceLanguage] || sourceLanguage;
    const targetLangName = languageNames[targetLanguage] || targetLanguage;

    const prompt = `You are a professional translator specializing in restaurant menus. Translate the following menu item from ${sourceLangName} to ${targetLangName}.

Menu Item Name: ${name}
Description: ${description}

IMPORTANT:
- Maintain the tone and style appropriate for a restaurant menu
- Keep any technical cooking terms accurate
- Preserve any specific ingredient names that don't have direct translations
- Keep the translation natural and appetizing for native speakers
- For food items, use culturally appropriate terms

Respond ONLY with a JSON object in this exact format:
{
  "name": "translated menu item name",
  "description": "translated description"
}`;

    try {
      const responseText = await generateTextWithClaude(prompt, {
        temperature: 0.3, // Lower temperature for more consistent translations
        maxTokens: 500,
      });
      
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to extract JSON from translation response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      if (!parsed.name || !parsed.description) {
        throw new Error('Invalid translation response format');
      }

      return {
        name: parsed.name,
        description: parsed.description,
      };
    } catch (error) {
      console.error('Translation error:', error);
      // Fallback: return original text if translation fails
      return { name, description };
    }
  }

  /**
   * Batch translate a menu item to multiple target languages
   * 
   * @param name - Menu item name
   * @param description - Menu item description
   * @param sourceLanguage - Source language code
   * @param targetLanguages - Array of target language codes
   * @returns Map of language code to translation
   */
  async translateMenuItemToMultipleLanguages(
    name: string,
    description: string,
    sourceLanguage: string,
    targetLanguages: string[]
  ): Promise<Map<string, { name: string; description: string }>> {
    const translations = new Map<string, { name: string; description: string }>();
    
    // Translate to each target language sequentially (could be parallelized with Promise.all)
    for (const targetLang of targetLanguages) {
      if (targetLang === sourceLanguage) {
        // Skip translating to same language
        translations.set(targetLang, { name, description });
        continue;
      }

      try {
        const translation = await this.translateMenuItem(
          name,
          description,
          sourceLanguage,
          targetLang
        );
        translations.set(targetLang, translation);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to translate to ${targetLang}:`, error);
        // Store original as fallback
        translations.set(targetLang, { name, description });
      }
    }

    return translations;
  }
}

// Create singleton instance
let translationService: TranslationService | null = null;

export function getTranslationService(): TranslationService | null {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn('AWS credentials not set, translation service disabled');
    return null;
  }

  if (!translationService) {
    translationService = new TranslationService();
  }

  return translationService;
}
