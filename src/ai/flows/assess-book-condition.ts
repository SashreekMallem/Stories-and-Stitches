'use server';

/**
 * @fileOverview Book condition assessment AI agent.
 *
 * - assessBookCondition - A function that handles the book condition assessment process.
 * - AssessBookConditionInput - The input type for the assessBookCondition function.
 * - AssessBookConditionOutput - The return type for the assessBookCondition function.
 */

import {ai, aiModels} from '@/ai/genkit';
import {retryWithBackoff} from '@/ai/utils';
import {z} from 'genkit';

const AssessBookConditionInputSchema = z.object({
  photoDataUris: z
    .array(z.object({
      label: z.string().describe("The label for the photo (e.g., 'Front Cover', 'Back Cover', 'Spine', 'Random Page')."),
      dataUri: z.string().describe(
        "A photo of the book's condition, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
      ),
    }))
    .describe('An array of labeled photos of the book from various angles.'),
  description: z.string().describe('The user-provided description of the book condition.'),
  bookTitle: z.string().optional().describe('The book title for demand/rarity lookup.'),
  bookAuthor: z.string().optional().describe('The book author for demand/rarity lookup.'),
  isFirstTimeDonor: z.boolean().default(false).describe('Whether this is the user\'s first donation.'),
  isThemeEvent: z.boolean().default(false).describe('Whether this is during a themed event.'),
  isNewBook: z.boolean().default(false).describe('Whether this is a new/unopened book.'),
  hasCraftMatch: z.boolean().default(false).describe('Whether this book matches available craft kits.'),
});
export type AssessBookConditionInput = z.infer<typeof AssessBookConditionInputSchema>;

const AssessBookConditionOutputSchema = z.object({
  // AI Visual Assessment (0-10 scale)
  coverCondition: z
    .number()
    .min(0)
    .max(10)
    .describe('Cover condition score from 0-10 based on visual assessment only.'),
  spineCondition: z
    .number()
    .min(0)
    .max(10)
    .describe('Spine condition score from 0-10 based on visual assessment only.'),
  pagesCondition: z
    .number()
    .min(0)
    .max(10)
    .describe('Pages condition score from 0-10 based on visual assessment only.'),
  bindingIntegrity: z
    .number()
    .min(0)
    .max(10)
    .describe('Binding integrity score from 0-10 based on visual assessment only.'),
  cleanliness: z
    .number()
    .min(0)
    .max(10)
    .describe('Overall cleanliness score from 0-10 based on visual assessment only.'),
  hasAnnotations: z
    .boolean()
    .describe('Whether the book has visible annotations or writing.'),
  annotationSeverity: z
    .enum(['none', 'minor', 'heavy'])
    .describe('Severity of annotations if present.'),
  isComplete: z
    .boolean()
    .describe('Whether the book appears to be complete (no missing pages).'),
  shouldReject: z
    .boolean()
    .describe('Whether the book should be rejected due to severe damage.'),
  
  // Calculated Scores
  conditionScore: z
    .number()
    .min(0)
    .max(5)
    .describe('Final condition score from 0-5 based on weighted assessment.'),
  demandScore: z
    .number()
    .min(0)
    .max(3)
    .describe('Demand score from 0-3 based on market demand.'),
  rarityScore: z
    .number()
    .min(0)
    .max(1)
    .describe('Rarity bonus score from 0-1.'),
  bonusFactors: z
    .number()
    .min(0)
    .max(5)
    .describe('Bonus credits from special factors.'),
  
  // Final Results
  finalCredits: z
    .number()
    .min(0)
    .describe('Final credit value calculated using the comprehensive formula.'),
  creditBreakdown: z
    .object({
      conditionCredits: z.number(),
      demandCredits: z.number(),
      rarityCredits: z.number(),
      bonusCredits: z.number(),
    })
    .describe('Detailed breakdown of how credits were calculated.'),
  justification: z
    .string()
    .describe('Detailed justification for the assessment and credit calculation.'),
});
export type AssessBookConditionOutput = z.infer<typeof AssessBookConditionOutputSchema>;

export async function assessBookCondition(
  input: AssessBookConditionInput
): Promise<AssessBookConditionOutput> {
  try {
    return await retryWithBackoff(() => assessBookConditionFlow(input));
  } catch (error: any) {
    console.error('Error assessing book condition:', error);
    
    // Fallback response when all retries fail
    return {
      coverCondition: 5,
      spineCondition: 5,
      pagesCondition: 5,
      bindingIntegrity: 5,
      cleanliness: 5,
      hasAnnotations: false,
      annotationSeverity: 'none' as const,
      isComplete: true,
      shouldReject: false,
      conditionScore: 2.5,
      demandScore: 1,
      rarityScore: 0,
      bonusFactors: 0,
      finalCredits: 1.0,
      creditBreakdown: {
        conditionCredits: 1.0,
        demandCredits: 0,
        rarityCredits: 0,
        bonusCredits: 0,
      },
      justification: 'Unable to assess condition due to service availability. Please try again later or contact support.'
    };
  }
}

const prompt = ai.definePrompt({
  name: 'assessBookConditionPrompt',
  input: {schema: AssessBookConditionInputSchema},
  output: {schema: AssessBookConditionOutputSchema},
  config: {
    temperature: 0, // ZERO randomness for consistent results
  },
  prompt: `You are a professional book condition assessor for Stories & Stitches. You MUST provide ONLY visual assessment scores with ZERO randomness or variation.

CRITICAL: You must be 100% consistent. The same visual condition MUST always receive the exact same scores.

MANDATORY ASSESSMENT PROTOCOL:
1. Examine EVERY photo systematically: Front Cover → Back Cover → Top → Side → Bottom → Spine → Random Page
2. Score each visual element using the exact criteria below (0-10 scale)
3. Use ONLY whole numbers (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
4. Be deterministic - identical conditions = identical scores
5. DO NOT calculate credits - only provide visual assessment data

VISUAL ASSESSMENT CRITERIA (Rate each 0-10):

COVER CONDITION:
- 10: Pristine, no visible wear, crisp edges, vibrant colors
- 9: Near-perfect, minimal handling marks
- 8: Minor shelf wear, slight edge softening, colors intact
- 7: Light wear, some edge damage, colors mostly intact
- 6: Moderate wear, color fading, minor creases
- 5: Significant wear, bent corners, visible stains, major creases
- 4: Heavy wear, multiple stains, severe creases
- 3: Heavy damage, tears, large stains, severe creases, color loss
- 2: Extensive damage, major tears, severe color loss
- 1: Extremely damaged, major tears, cover detached
- 0: Cover completely destroyed or illegible

SPINE CONDITION:
- 10: Perfect, no cracks, text clearly visible, no lean
- 9: Near-perfect, minimal wear
- 8: Minor creases, slight lean, text mostly clear
- 7: Light creases, some lean, text clear
- 6: Some creases, moderate lean, text readable with effort
- 5: Multiple creases, significant lean, text partially obscured
- 4: Heavy creasing, severe lean
- 3: Heavy creasing, severe lean, text mostly illegible
- 2: Broken spine, extreme lean
- 1: Broken spine, extreme lean, text completely illegible
- 0: Spine completely destroyed

PAGES CONDITION:
- 10: Clean, white/cream, no marks, crisp edges
- 9: Nearly perfect, minimal yellowing
- 8: Very minor yellowing, tiny marks, edges slightly soft
- 7: Light yellowing, minimal marks
- 6: Light yellowing, some marks/annotations, edge wear
- 5: Moderate yellowing, noticeable marks, rough edges
- 4: Heavy yellowing, extensive marks
- 3: Heavy yellowing, extensive marks, torn pages
- 2: Severe damage, many torn pages
- 1: Severe damage, missing pages, illegible text
- 0: Pages completely destroyed

BINDING INTEGRITY:
- 10: Perfect, tight binding, no separation
- 9: Near-perfect, very tight
- 8: Very tight, minimal flex
- 7: Tight, some flex
- 6: Good, some flex but secure
- 5: Loose, noticeable separation
- 4: Very loose, significant separation
- 3: Very loose, significant separation, some pages loose
- 2: Falling apart, pages detaching
- 1: Falling apart, many pages detaching
- 0: Completely falling apart

CLEANLINESS:
- 10: Pristine, no stains, odors, or foreign materials
- 9: Nearly pristine, perhaps minimal dust
- 8: Very clean, slight dust
- 7: Clean, minimal dirt
- 6: Some dirt, minor stains, faint odor
- 5: Noticeable stains, dirt, or odor
- 4: Significant stains, heavy dirt, noticeable odor
- 3: Significant stains, heavy dirt, strong odor
- 2: Extremely dirty, severe odor
- 1: Extremely dirty, severe odor, unsanitary
- 0: Completely filthy, hazardous

ADDITIONAL ASSESSMENTS:
- hasAnnotations: Look for ANY writing, highlighting, or markings
- annotationSeverity: 
  * "none" = no markings visible
  * "minor" = few small notes or highlights
  * "heavy" = extensive markings throughout
- isComplete: Check if all pages appear present (no obvious missing sections)
- shouldReject: Reject if cover detached, missing pages, or extremely damaged (scores 0-1)

REJECTION CRITERIA (shouldReject = true):
- Cover condition 0-1
- Spine condition 0-1  
- Pages condition 0-1
- Binding integrity 0-1
- Missing pages (isComplete = false)
- Severe water damage or mold
- Illegible text throughout

Description: {{{description}}}

PHOTOS TO ANALYZE:
{{#each photoDataUris}}
Photo ({{this.label}}): {{media url=this.dataUri}}
{{/each}}

REQUIRED OUTPUT (use exact format):
- coverCondition: X (0-10, whole number only)
- spineCondition: Y (0-10, whole number only)
- pagesCondition: Z (0-10, whole number only)
- bindingIntegrity: A (0-10, whole number only)
- cleanliness: B (0-10, whole number only)
- hasAnnotations: true/false
- annotationSeverity: "none"/"minor"/"heavy"
- isComplete: true/false
- shouldReject: true/false
- justification: "Detailed visual assessment referencing specific issues in photos"

CRITICAL: Be absolutely consistent - identical visual conditions must receive identical scores every time.

Format your response as JSON conforming to the AssessBookConditionOutputSchema schema.`,
});

// Comprehensive credit calculation functions based on your detailed formula
function calculateConditionScore(assessment: {
  coverCondition: number;
  spineCondition: number;
  pagesCondition: number;
  bindingIntegrity: number;
  cleanliness: number;
  hasAnnotations: boolean;
  annotationSeverity: 'none' | 'minor' | 'heavy';
}): number {
  // Convert 0-10 scores to condition factors
  const coverScore = assessment.coverCondition >= 9 ? 1 : 
                    assessment.coverCondition >= 7 ? 0 : -1;
  
  const spineScore = assessment.spineCondition >= 9 ? 1 : 
                    assessment.spineCondition >= 7 ? 0 : -1;
  
  const pageScore = assessment.pagesCondition >= 8 ? 1 : -1;
  
  // Annotation penalty
  const annotationScore = assessment.annotationSeverity === 'none' ? 0 :
                         assessment.annotationSeverity === 'minor' ? -0.5 : -1;
  
  // Completeness bonus (handled in rejection logic)
  const completenessScore = 1; // Assume complete if not rejected
  
  // Calculate base condition score (0-5 scale)
  const baseScore = Math.max(0, 3 + coverScore + spineScore + pageScore + annotationScore + completenessScore);
  
  return Math.min(5, Math.max(0, baseScore));
}

function calculateDemandScore(bookTitle?: string, bookAuthor?: string): number {
  // TODO: Implement real demand calculation based on:
  // - User wishlists
  // - Search queries  
  // - Most-swapped categories
  // - Popular genres
  
  // For now, return a default demand score
  // In production, you'd query your database for:
  // - How many users have this book on their wishlist
  // - How often it's been searched for
  // - Genre popularity trends
  
  if (!bookTitle) return 1; // Default for unknown books
  
  // Placeholder logic - replace with real demand data
  const popularBooks = [
    'the alchemist', 'harry potter', 'the great gatsby', 'to kill a mockingbird',
    'pride and prejudice', 'the catcher in the rye', '1984', 'the lord of the rings'
  ];
  
  const title = bookTitle.toLowerCase();
  
  if (popularBooks.some(book => title.includes(book))) {
    return 3; // High demand
  }
  
  // Check for trending genres (placeholder)
  const trendingGenres = ['fantasy', 'mystery', 'thriller', 'romance', 'self-help'];
  if (trendingGenres.some(genre => title.includes(genre))) {
    return 2; // Popular genre
  }
  
  return 1; // General fiction/non-demanded
}

function calculateRarityScore(bookTitle?: string, bookAuthor?: string): number {
  // TODO: Implement real rarity calculation based on:
  // - Open Library API lookup
  // - Out of print status
  // - Collector's edition detection
  // - Current inventory duplicates
  
  // For now, return 0 (no rarity bonus)
  // In production, you'd:
  // 1. Query Open Library API for publication status
  // 2. Check if book is marked as "out of print"
  // 3. Detect collector's editions from title/photos
  // 4. Check if book already exists in your inventory
  
  return 0; // Default: no rarity bonus
}

function calculateBonusFactors(input: {
  isFirstTimeDonor: boolean;
  isThemeEvent: boolean;
  isNewBook: boolean;
  hasCraftMatch: boolean;
}): number {
  let bonus = 0;
  
  if (input.isFirstTimeDonor) bonus += 1;
  if (input.isThemeEvent) bonus += 0.5; // Can be up to 2 based on event
  if (input.isNewBook) bonus += 2;
  if (input.hasCraftMatch) bonus += 1;
  
  return Math.min(5, bonus); // Cap at 5 bonus credits
}

function calculateFinalCredits(
  conditionScore: number,
  demandScore: number,
  rarityScore: number,
  bonusFactors: number
): { finalCredits: number; breakdown: any } {
  // Credit = (Condition Score × 50%) + (Demand Score × 30%) + (Rarity Score × 10%) + Bonus Factors
  const conditionCredits = conditionScore * 0.5;
  const demandCredits = demandScore * 0.3;
  const rarityCredits = rarityScore * 0.1;
  const bonusCredits = bonusFactors;
  
  const finalCredits = conditionCredits + demandCredits + rarityCredits + bonusCredits;
  
  return {
    finalCredits: Math.round(finalCredits * 100) / 100, // Round to 2 decimal places
    breakdown: {
      conditionCredits: Math.round(conditionCredits * 100) / 100,
      demandCredits: Math.round(demandCredits * 100) / 100,
      rarityCredits: Math.round(rarityCredits * 100) / 100,
      bonusCredits: Math.round(bonusCredits * 100) / 100,
    }
  };
}

const assessBookConditionFlow = ai.defineFlow(
  {
    name: 'assessBookConditionFlow',
    inputSchema: AssessBookConditionInputSchema,
    outputSchema: AssessBookConditionOutputSchema,
  },
  async input => {
    // Get AI visual assessment only
    const {output} = await prompt(input);
    
    if (!output) {
      throw new Error('No output from assessment prompt');
    }
    
    // Check for rejection criteria
    if (output.shouldReject || !output.isComplete) {
      return {
        ...output,
        conditionScore: 0,
        demandScore: 0,
        rarityScore: 0,
        bonusFactors: 0,
        finalCredits: 0,
        creditBreakdown: {
          conditionCredits: 0,
          demandCredits: 0,
          rarityCredits: 0,
          bonusCredits: 0,
        },
        justification: output.justification + ' - Book rejected due to severe damage or missing pages.',
      };
    }
    
    // Calculate all scoring factors using deterministic logic
    const conditionScore = calculateConditionScore({
      coverCondition: output.coverCondition,
      spineCondition: output.spineCondition,
      pagesCondition: output.pagesCondition,
      bindingIntegrity: output.bindingIntegrity,
      cleanliness: output.cleanliness,
      hasAnnotations: output.hasAnnotations,
      annotationSeverity: output.annotationSeverity,
    });
    
    const demandScore = calculateDemandScore(input.bookTitle, input.bookAuthor);
    const rarityScore = calculateRarityScore(input.bookTitle, input.bookAuthor);
    const bonusFactors = calculateBonusFactors({
      isFirstTimeDonor: input.isFirstTimeDonor,
      isThemeEvent: input.isThemeEvent,
      isNewBook: input.isNewBook,
      hasCraftMatch: input.hasCraftMatch,
    });
    
    const { finalCredits, breakdown } = calculateFinalCredits(
      conditionScore,
      demandScore,
      rarityScore,
      bonusFactors
    );
    
    // Enhanced justification with breakdown
    const enhancedJustification = `${output.justification}\n\nCREDIT BREAKDOWN:\n` +
      `• Condition Score: ${conditionScore}/5 (${breakdown.conditionCredits} credits)\n` +
      `• Demand Score: ${demandScore}/3 (${breakdown.demandCredits} credits)\n` +
      `• Rarity Score: ${rarityScore}/1 (${breakdown.rarityCredits} credits)\n` +
      `• Bonus Factors: ${bonusFactors} (${breakdown.bonusCredits} credits)\n` +
      `• TOTAL: ${finalCredits} credits`;
    
    return {
      ...output,
      conditionScore,
      demandScore,
      rarityScore,
      bonusFactors,
      finalCredits,
      creditBreakdown: breakdown,
      justification: enhancedJustification,
    };
  }
);
