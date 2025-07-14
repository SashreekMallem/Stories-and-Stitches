'use server';

/**
 * @fileOverview Book condition assessment AI agent.
 *
 * - assessBookCondition - A function that handles the book condition assessment process.
 * - AssessBookConditionInput - The input type for the assessBookCondition function.
 * - AssessBookConditionOutput - The return type for the assessBookCondition function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AssessBookConditionInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of the book's condition, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
  description: z.string().describe('The description of the book condition.'),
});
export type AssessBookConditionInput = z.infer<typeof AssessBookConditionInputSchema>;

const AssessBookConditionOutputSchema = z.object({
  conditionScore: z
    .number()
    .describe(
      'A score between 0 and 1 indicating the condition of the book, where 0 is very poor and 1 is excellent.'
    ),
  creditEstimate: z
    .number()
    .describe('The estimated credit value for the book based on its condition.'),
  justification: z
    .string()
    .describe('A justification for the condition score and credit estimate.'),
});
export type AssessBookConditionOutput = z.infer<typeof AssessBookConditionOutputSchema>;

export async function assessBookCondition(
  input: AssessBookConditionInput
): Promise<AssessBookConditionOutput> {
  return assessBookConditionFlow(input);
}

const prompt = ai.definePrompt({
  name: 'assessBookConditionPrompt',
  input: {schema: AssessBookConditionInputSchema},
  output: {schema: AssessBookConditionOutputSchema},
  prompt: `You are an expert book appraiser specializing in determining the condition and value of used books for credit purposes.

You will use the provided information, including a description and a photo, to assess the book's condition and estimate its credit value.

Description: {{{description}}}
Photo: {{media url=photoDataUri}}

Based on the condition, provide a condition score between 0 and 1 (0 = very poor, 1 = excellent) and an estimated credit value.  Also, provide a justification for your assessment.

Format your response as JSON conforming to the AssessBookConditionOutputSchema schema.`,
});

const assessBookConditionFlow = ai.defineFlow(
  {
    name: 'assessBookConditionFlow',
    inputSchema: AssessBookConditionInputSchema,
    outputSchema: AssessBookConditionOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
