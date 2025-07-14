import { config } from 'dotenv';
config();

import '@/ai/flows/extract-book-metadata.ts';
import '@/ai/flows/assess-book-condition.ts';
import '@/ai/flows/is-book-ready-for-capture.ts';
