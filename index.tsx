import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { LeonardoAPI, GenerationResult, GenerationParams } from './leonardo';
import {
    getModelConfig,
    getModelsForNodeType,
    ASPECT_RATIO_DIMENSIONS,
    IMAGE_GEN_STYLES,
    CONTRAST_VALUES,
    ModelConfigEntry
} from './modelConfig';

const App: React.FC = () => {
    const imageModels = getModelsForNodeType('image-generation');

    const [apiKey, setApiKey] = useState<string>('');
    const [prompt, setPrompt] = useState<string>('A majestic lion in a futuristic city, photorealistic');
    const [modelName, setModelName] = useState<string>(imageModels[0]);
    
    // Derived state for the selected model's configuration
    const [selectedConfig, setSelectedConfig] = useState<ModelConfigEntry | null>(getModelConfig(modelName));

    // --- Generation parameters state ---
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [width, setWidth] = useState<number>(1024);
    const [height, setHeight] = useState<number>(1024);
    const [style, setStyle] = useState<string>('None');
    const [contrast, setContrast] = useState<number>(1.0);
    const [alchemy, setAlchemy] = useState<boolean>(false);
    const [photoReal, setPhotoReal] = useState<boolean>(false);
    
    // --- App status state ---
    const [loading, setLoading] = useState<boolean>(false);
    const [status, setStatus] = useState<string>('Idle. Enter your API Key and a prompt to begin.');
    const [error, setError] = useState<string | null>(null);
    const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
    const [debugResponse, setDebugResponse] = useState<string | null>(null);

    // Effect to update configuration when model changes
    useEffect(() => {
        const newConfig = getModelConfig(modelName);
        if (newConfig) {
            setSelectedConfig(newConfig);
            const defaults = newConfig.defaults || {};
            
            // Set alchemy based on model support first
            const alchemySupported = newConfig.supports.alchemy || false;
            setAlchemy(alchemySupported);
            // PhotoReal requires alchemy
            setPhotoReal(alchemySupported && (defaults.photoReal || false));

            // Set style and contrast from defaults
            setStyle(defaults.style || 'None');
            if (newConfig.supports.contrast) {
                setContrast(defaults.contrast || 1.0);
            }

            // Set a valid default aspect ratio for the new model
            const supportedRatios = newConfig.supports.aspectRatios || ['1:1'];
            const defaultRatio = supportedRatios.includes('1:1') ? '1:1' : supportedRatios[0];
            setAspectRatio(defaultRatio);
        }
    }, [modelName]);

    // Effect to update dimensions when aspect ratio changes
    useEffect(() => {
        const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio];
        if (dimensions) {
            setWidth(dimensions.width);
            setHeight(dimensions.height);
        }
    }, [aspectRatio]);

    // Effect to ensure PhotoReal is disabled if Alchemy is turned off
    useEffect(() => {
        if (!alchemy) {
            setPhotoReal(false);
        }
    }, [alchemy]);
    
    // Utility to poll for the generation result
    const pollForResult = useCallback(async (api: LeonardoAPI, generationId: string): Promise<GenerationResult> => {
        let attempts = 0;
        const maxAttempts = 30; // Poll for a maximum of 5 minutes (30 * 10s)
        
        while (attempts < maxAttempts) {
            setStatus(`Polling for result... (Attempt ${attempts + 1})`);
            const response = await api.getGenerationById(generationId);
            setDebugResponse(JSON.stringify(response, null, 2));

            const generation = response.generations_by_pk;
            if (generation?.status === 'COMPLETE') {
                return response;
            } else if (generation?.status === 'FAILED') {
                throw new Error('Generation failed.');
            }
            
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            attempts++;
        }

        throw new Error('Polling timed out.');
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey) {
            setError('API Key is required.');
            return;
        }
        if (!selectedConfig) {
            setError('Could not find configuration for the selected model.');
            return;
        }

        setLoading(true);
        setError(null);
        setResultImageUrl(null);
        setDebugResponse(null);
        setStatus('Initializing generation...');

        try {
            const api = new LeonardoAPI(apiKey);
            
            const params: GenerationParams = {
                prompt,
                modelId: selectedConfig.id,
                width,
                height,
                num_images: 1,
            };

            // Add conditional parameters based on model support and UI state
            if (selectedConfig.supports.alchemy) {
                params.alchemy = alchemy;
                if (alchemy) {
                    params.photoReal = photoReal;
                    if (style && style !== 'None') {
                         // Convert 'Sketch Bw' to 'SKETCH_BW' for the API
                        params.presetStyle = style.toUpperCase().replace(/\s/g, '_');
                    }
                }
            }

            if (selectedConfig.supports.contrast) {
                params.contrast = contrast;
            }

            setStatus('Sending generation request...');
            setDebugResponse(`Request Payload:\n${JSON.stringify(params, null, 2)}`);
            const initialResponse = await api.generateImage(params);

            const generationId = initialResponse.sdGenerationJob?.generationId;
            if (!generationId) {
                throw new Error('Failed to get generation ID from the initial response.');
            }
            setDebugResponse(JSON.stringify(initialResponse, null, 2));
            
            const finalResult = await pollForResult(api, generationId);
            const imageUrl = finalResult.generations_by_pk?.generated_images?.[0]?.url;
            
            if (imageUrl) {
                setResultImageUrl(imageUrl);
                setStatus('Generation Complete!');
            } else {
                throw new Error('Generation completed, but no image URL was found.');
            }

        } catch (err: any) {
            setError(err.message || 'An unknown error occurred.');
            setStatus('Error occurred.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <h1>Leonardo AI API Test Interface</h1>

            <div className="card">
                <h2>1. Configuration</h2>
                <div className="form-group">
                    <label htmlFor="api-key">Leonardo API Key</label>
                    <input
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Enter your Leonardo AI API Key"
                        aria-required="true"
                    />
                    <p className="warning">Note: Your API Key is handled client-side and not stored. For production apps, use a backend proxy.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="card">
                    <h2>2. Generation Parameters</h2>
                    <div className="form-group">
                        <label htmlFor="prompt">Prompt</label>
                        <textarea
                            id="prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={4}
                            aria-label="Image generation prompt"
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="model">Model</label>
                        <select id="model" value={modelName} onChange={(e) => setModelName(e.target.value)} aria-label="Select generation model">
                            {imageModels.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="aspect-ratio">Aspect Ratio ({width}x{height})</label>
                        <select 
                          id="aspect-ratio" 
                          value={aspectRatio} 
                          onChange={(e) => setAspectRatio(e.target.value)} 
                          aria-label="Select aspect ratio"
                          disabled={!selectedConfig?.supports.aspectRatios}
                        >
                            {selectedConfig?.supports.aspectRatios?.map(ratio => (
                                <option key={ratio} value={ratio}>{ratio}</option>
                            ))}
                        </select>
                    </div>

                    {selectedConfig?.supports.alchemy && (
                         <div className="form-group toggle-group">
                            <label htmlFor="alchemy">Alchemy</label>
                            <input type="checkbox" id="alchemy" checked={alchemy} onChange={(e) => setAlchemy(e.target.checked)} />
                         </div>
                    )}
                    {selectedConfig?.supports.alchemy && alchemy && (
                        <>
                        <div className="form-group toggle-group">
                           <label htmlFor="photo-real">PhotoReal</label>
                           <input type="checkbox" id="photo-real" checked={photoReal} onChange={(e) => setPhotoReal(e.target.checked)} />
                        </div>
                        <div className="form-group">
                            <label htmlFor="style">Style</label>
                            <select id="style" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Select generation style">
                                {IMAGE_GEN_STYLES.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        </>
                    )}

                    {selectedConfig?.supports.contrast && (
                         <div className="form-group">
                            <label htmlFor="contrast">Contrast</label>
                            <select id="contrast" value={contrast} onChange={(e) => setContrast(parseFloat(e.target.value))} aria-label="Select contrast level">
                                {CONTRAST_VALUES.map(c => (
                                    <option key={c} value={c}>{c.toFixed(1)}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <button type="submit" disabled={loading || !apiKey}>
                        {loading ? 'Generating...' : 'Generate Image'}
                    </button>
                </div>
            </form>

            <div className="card">
                <h2>3. Results</h2>
                <div className="status-area">
                    <h3>Status</h3>
                    <p>{status}</p>
                    {error && <p className="warning">Error: {error}</p>}
                </div>
                <div className="output-area">
                    {loading && <p>Please wait, this can take a minute...</p>}
                    {resultImageUrl && <img src={resultImageUrl} alt="Generated by Leonardo AI" />}
                    {!loading && !resultImageUrl && <p>Generated image will appear here.</p>}
                </div>
                 {debugResponse && (
                    <div>
                        <h3>Debug Information</h3>
                        <pre>{debugResponse}</pre>
                    </div>
                )}
            </div>
        </>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);