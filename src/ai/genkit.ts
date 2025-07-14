import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

export const ai = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-1.5-flash', // Using more stable model instead of 2.0-flash
});

// Alternative models for fallback
export const aiModels = {
  primary: 'googleai/gemini-1.5-flash',
  fallback: 'googleai/gemini-1.5-pro',
  backup: 'googleai/gemini-1.0-pro'
};
