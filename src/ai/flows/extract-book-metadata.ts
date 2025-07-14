'use server';

/**
 * @fileOverview A flow to extract book metadata (title and author) from an image using GenAI and OCR.
 *
 * - extractBookMetadata - A function that handles the book metadata extraction process.
 * - ExtractBookMetadataInput - The input type for the extractBookMetadata function.
 * - ExtractBookMetadataOutput - The return type for the extractBookMetadata function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractBookMetadataInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of the book cover, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ExtractBookMetadataInput = z.infer<typeof ExtractBookMetadataInputSchema>;

const ExtractBookMetadataOutputSchema = z.object({
  title: z.string().describe('The title of the book.'),
  author: z.string().describe('The author of the book.'),
});
export type ExtractBookMetadataOutput = z.infer<typeof ExtractBookMetadataOutputSchema>;

export async function extractBookMetadata(input: ExtractBookMetadataInput): Promise<ExtractBookMetadataOutput> {
  return extractBookMetadataFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractBookMetadataPrompt',
  input: {schema: ExtractBookMetadataInputSchema},
  output: {schema: ExtractBookMetadataOutputSchema},
  prompt: `You are an expert librarian. Extract the title and author of the book from the following image. If you cannot extract the information, leave the field blank, don't make up a title or author.

Book Cover: {{media url=photoDataUri}}`,
});

const extractBookMetadataFlow = ai.defineFlow(
  {
    name: 'extractBookMetadataFlow',
    inputSchema: ExtractBookMetadataInputSchema,
    outputSchema: ExtractBookMetadataOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
