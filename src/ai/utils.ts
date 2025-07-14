/**
 * @fileOverview Utilities for AI operations including retry logic and error handling
 */

/**
 * Retry function with exponential backoff for handling overloaded AI models
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === maxRetries - 1) throw error;
      
      // Check if it's a 503 (overloaded) error or service unavailable
      if (error?.status === 503 || 
          error?.statusText === 'Service Unavailable' ||
          error?.message?.includes('overloaded')) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
        console.log(`AI model overloaded, retrying in ${Math.round(delay)}ms... (attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error; // Don't retry for other types of errors
      }
    }
  }
  throw new Error('Max retries exceeded');
}

/**
 * Check if an error is a temporary service issue that should be retried
 */
export function isRetryableError(error: any): boolean {
  return error?.status === 503 || 
         error?.statusText === 'Service Unavailable' ||
         error?.message?.includes('overloaded') ||
         error?.message?.includes('quota') ||
         error?.message?.includes('rate limit');
}
