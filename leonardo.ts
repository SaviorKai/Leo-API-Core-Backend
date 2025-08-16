// Type definitions based on Leonardo AI API documentation patterns

export interface GenerationParams {
    prompt: string;
    negative_prompt?: string;
    modelId?: string | null;
    width?: number;
    height?: number;
    num_images?: number;
    alchemy?: boolean;
    photoReal?: boolean;
    photoRealVersion?: string;
    photoRealStrength?: number;
    contrastRatio?: number;
    presetStyle?: string;
    guidance_scale?: number;
    num_inference_steps?: number;
    seed?: number;
    highContrast?: boolean;
    contrast?: number;
    init_image_id?: string;
    init_generation_image_id?: string;
    init_strength?: number;
    imagePromptWeight?: number;
    // controlnets?: any[]; // For future use
    // elements?: any[]; // For future use
}

export interface InitialGenerationResponse {
    sdGenerationJob?: {
        generationId: string;
    };
}

export interface GenerationResult {
    generations_by_pk?: {
        id: string;
        status: 'PENDING' | 'COMPLETE' | 'FAILED';
        generated_images?: {
            id: string;
            url: string;
        }[];
    };
}

/**
 * A reusable class to interact with the Leonardo AI API.
 */
export class LeonardoAPI {
    private readonly apiKey: string;
    private readonly baseUrl: string = 'https://cloud.leonardo.ai/api/rest/v1';

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error('Leonardo API key is required.');
        }
        this.apiKey = apiKey;
    }

    private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'accept': 'application/json',
        };

        const config: RequestInit = {
            ...options,
            headers: { ...headers, ...options.headers },
        };

        try {
            const response = await fetch(url, config);
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
            }
            return await response.json() as T;
        } catch (error) {
            console.error('Leonardo API request error:', error);
            throw error;
        }
    }

    /**
     * Initiates an image generation job.
     * @param params - The parameters for the image generation.
     * @returns A promise that resolves to the initial response containing the generation ID.
     */
    public generateImage(params: GenerationParams): Promise<InitialGenerationResponse> {
        return this.request<InitialGenerationResponse>('/generations', {
            method: 'POST',
            body: JSON.stringify(params),
        });
    }

    /**
     * Retrieves the status and result of a generation job.
     * @param generationId - The ID of the generation job to check.
     * @returns A promise that resolves to the generation result.
     */
    public getGenerationById(generationId: string): Promise<GenerationResult> {
        return this.request<GenerationResult>(`/generations/${generationId}`);
    }
}