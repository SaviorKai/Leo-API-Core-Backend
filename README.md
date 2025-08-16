# Leonardo AI API Integration Layer

This project provides a foundational, reusable API integration layer for [Leonardo AI](https://leonardo.ai/) and a simple test interface to verify its functionality. The core logic is encapsulated in a standalone module (`leonardo.ts`) that can be easily imported into any frontend or backend JavaScript/TypeScript project.

## Project Purpose

The primary goal is to establish a robust and well-documented set of functions for interacting with the Leonardo AI API. This layer handles authentication, API requests for image generation, and polling for results, simplifying the process of building AI-powered applications.

## File Structure

-   `index.html`: The main entry point for the test application. It sets up the basic HTML structure and styling.
-   `index.tsx`: A React-based single-page application that provides a user interface for testing the API integration.
-   `leonardo.ts`: **The core API integration layer.** This module contains the `LeonardoAPI` class, which is responsible for all communication with the Leonardo AI API.
-   `modelConfig.ts`: A centralized configuration file that exports a list of available Leonardo AI models. This acts as a single source of truth for models used in the application.
-   `README.md`: This documentation file.

## How to Use the API Layer (`leonardo.ts`) in Another Project

The `leonardo.ts` module is designed to be completely self-contained. To use it in another project:

1.  **Copy the Files:** Copy `leonardo.ts` and `modelConfig.ts` into your project's source directory (e.g., `src/api/`).

2.  **Import and Initialize:** Import the `LeonardoAPI` class and instantiate it with your API key.

    ```typescript
    import { LeonardoAPI } from './path/to/leonardo';

    // It's highly recommended to use environment variables for your API key
    const apiKey = process.env.LEONARDO_API_KEY || 'your-api-key-here';
    const api = new LeonardoAPI(apiKey);
    ```

3.  **Generate an Image:** Use the `generateImage` and `getGenerationById` methods. The process is asynchronous and requires polling.

    ```typescript
    async function createImage(prompt: string) {
        try {
            // 1. Start the generation job
            console.log('Starting image generation...');
            const initialResponse = await api.generateImage({
                prompt: prompt,
                modelId: '6bef9f1b-29cb-40c7-b9df-32b51c1f67d3', // e.g., Leonardo Diffusion XL
                width: 1024,
                height: 1024,
            });

            const generationId = initialResponse.sdGenerationJob?.generationId;
            if (!generationId) {
                throw new Error('Could not get generation ID.');
            }
            console.log(`Generation started with ID: ${generationId}`);

            // 2. Poll for the result
            let imageUrl: string | undefined;
            while (!imageUrl) {
                console.log('Polling for result...');
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

                const statusResponse = await api.getGenerationById(generationId);
                const generation = statusResponse.generations_by_pk;

                if (generation?.status === 'COMPLETE') {
                    imageUrl = generation.generated_images?.[0]?.url;
                    break; // Exit loop on completion
                } else if (generation?.status === 'FAILED') {
                    throw new Error('Image generation failed.');
                }
                // If status is 'PENDING', the loop continues
            }

            console.log(`Image generated successfully: ${imageUrl}`);
            return imageUrl;

        } catch (error) {
            console.error('An error occurred:', error);
        }
    }

    createImage('A cinematic shot of a raccoon astronaut on Mars');
    ```

## Running the Test UI

1.  Open the `index.html` file in your web browser.
2.  Enter your Leonardo AI API key in the configuration section.
3.  Adjust the prompt and other parameters as needed.
4.  Click "Generate Image" to start the process.
5.  The status and final image will be displayed in the results section.

### A Note on CORS

When running in a browser, API requests from a web page to a different domain are subject to the Cross-Origin Resource Sharing (CORS) policy. If the Leonardo AI API does not explicitly allow requests from your domain (or `null` origin for local files), these requests will be blocked by the browser.

For a production application, the standard solution is to create a small backend server (e.g., using Node.js/Express) that acts as a proxy. Your frontend would make requests to your backend, which would then securely make requests to the Leonardo AI API, bypassing the browser's CORS restrictions.
