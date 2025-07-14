'use server';

/**
 * @fileOverview A flow to determine if an image contains a clear, well-positioned book cover suitable for OCR.
 *
 * - isBookReadyForCapture - A function that handles the book readiness check.
 * - IsBookReadyForCaptureInput - The input type for the isBookReadyForCapture function.
 * - IsBookReadyForCaptureOutput - The return type for the isBookReadyForCapture function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const IsBookReadyForCaptureInputSchema = z.object({
  photoDataUri: z
    .string()
    .describe(
      "A photo of a potential book cover, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type IsBookReadyForCaptureInput = z.infer<typeof IsBookReadyForCaptureInputSchema>;

const IsBookReadyForCaptureOutputSchema = z.object({
  isReady: z.boolean().describe('True if the image is a clear, well-lit, front-facing book cover, otherwise false.'),
});
export type IsBookReadyForCaptureOutput = z.infer<typeof IsBookReadyForCaptureOutputSchema>;

export async function isBookReadyForCapture(input: IsBookReadyForCaptureInput): Promise<IsBookReadyForCaptureOutput> {
  return isBookReadyForCaptureFlow(input);
}

const prompt = ai.definePrompt({
  name: 'isBookReadyForCapturePrompt',
  input: {schema: IsBookReadyForCaptureInputSchema},
  output: {schema: IsBookReadyForCaptureOutputSchema},
  prompt: `Analyze the image to determine if it's a good photo for extracting book details.
The image should contain a single book cover, be well-lit, in focus, and facing the camera directly.
If the image meets these criteria, set isReady to true. Otherwise, set it to false.

Image: {{media url=photoDataUri}}`,
});

const isBookReadyForCaptureFlow = ai.defineFlow(
  {
    name: 'isBookReadyForCaptureFlow',
    inputSchema: IsBookReadyForCaptureInputSchema,
    outputSchema: IsBookReadyForCaptureOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
