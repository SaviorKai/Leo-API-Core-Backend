// Type definitions based on Leonardo AI API documentation patterns

interface ControlNetWithWeight {
    initImageId: string;
    initImageType: 'UPLOADED';
    preprocessorId: number;
    weight: number;
}
interface ControlNetWithStrengthType {
    initImageId: string;
    initImageType: 'UPLOADED';
    preprocessorId: number;
    strengthType: string;
}
export type ControlNetParams = ControlNetWithWeight | ControlNetWithStrengthType;

interface ContextImageParams {
    init_image_id: string;
    context: string;
}

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
    controlnets?: ControlNetParams[];
    contextImages?: ContextImageParams[];
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

export interface InitImageUploadResponse {
    uploadInitImage: {
        id: string;
        fields: string; // This is a JSON string
        key: string;
        url: string;
    }
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

    /**
     * Step 1 of 2 for uploading an image for Image Guidance.
     * Requests a presigned URL to upload an image to.
     * @param extension - The file extension of the image (e.g., "png", "jpg").
     * @returns A promise that resolves to the upload details.
     */
    public getInitImageUploadUrl(extension: string): Promise<InitImageUploadResponse> {
        const payload = {
            extension: extension.toLowerCase()
        };
        return this.request<InitImageUploadResponse>('/init-image', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    /**
     * Step 2 of 2 for uploading an image.
     * Uploads the image file to the presigned S3 URL provided by Leonardo.
     * @param uploadUrl - The presigned URL from getInitImageUploadUrl.
     * @param fields - The form fields from getInitImageUploadUrl.
     * @param file - The image file to upload.
     * @returns A promise that resolves when the upload is complete.
     */
    public async uploadImageToS3(uploadUrl: string, fields: Record<string, string>, file: File): Promise<void> {
        const formData = new FormData();
        Object.entries(fields).forEach(([key, value]) => {
            formData.append(key, value);
        });
        // The 'file' field must be the last one added to the form for S3 presigned POSTs.
        formData.append('file', file);
    
        try {
            // Using 'no-cors' mode to bypass browser CORS restrictions when running from a `file://` URL.
            // This is a workaround for local development.
            // The limitation is that we cannot read the response from the server,
            // so we can't confirm if the upload was successful. We proceed optimistically.
            // If the upload failed, the error will surface later during the image generation step.
            await fetch(uploadUrl, {
                method: 'POST',
                body: formData,
                mode: 'no-cors',
            });
        } catch (error) {
            // This catch block handles network errors that prevent the request from being sent at all.
            console.error('S3 upload network error:', error);
            // Provide a generic error message as we can't be sure of the cause.
            throw new Error('Upload failed due to a network error.');
        }
    }
}