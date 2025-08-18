import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { LeonardoAPI, GenerationResult, GenerationParams, ControlNetParams } from './leonardo';
import {
    getModelConfig,
    getModelsForNodeType,
    ASPECT_RATIO_DIMENSIONS,
    IMAGE_GEN_STYLES,
    CONTRAST_VALUES,
    ModelConfigEntry
} from './modelConfig';

const GUIDANCE_STRENGTH_TYPES: Record<string, string[]> = {
    'Style Reference': ['Low', 'Mid', 'High', 'Ultra', 'Max'],
    'Character Reference': ['Low', 'Mid', 'High'],
    'Content Reference': ['Low', 'Mid', 'High'],
};

interface GuidanceImage {
    // A temporary ID for React keys
    tempId: string;
    // The final ID from Leonardo API
    id?: string;
    file: File;
    previewUrl: string;
    status: 'uploading' | 'ready' | 'error';
    error?: string;
    // Config
    guidanceType: string;
    strengthType: string;
    weight: number;
    contextType?: string;
}

const App: React.FC = () => {
    const imageModels = getModelsForNodeType('image-generation');

    const [apiKey, setApiKey] = useState<string>('');
    const [prompt, setPrompt] = useState<string>('A majestic lion in a futuristic city, photorealistic');
    const [modelName, setModelName] = useState<string>(imageModels[0]);
    
    const [selectedConfig, setSelectedConfig] = useState<ModelConfigEntry | null>(getModelConfig(modelName));

    // --- Generation parameters state ---
    const [aspectRatio, setAspectRatio] = useState<string>('1:1');
    const [width, setWidth] = useState<number>(1024);
    const [height, setHeight] = useState<number>(1024);
    const [style, setStyle] = useState<string>('None');
    const [contrast, setContrast] = useState<number>(1.0);
    const [alchemy, setAlchemy] = useState<boolean>(false);
    const [photoReal, setPhotoReal] = useState<boolean>(false);
    const [guidanceImages, setGuidanceImages] = useState<GuidanceImage[]>([]);
    
    // --- App status state ---
    const [loading, setLoading] = useState<boolean>(false);
    const [status, setStatus] = useState<string>('Idle. Enter your API Key and a prompt to begin.');
    const [error, setError] = useState<string | null>(null);
    const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
    const [debugRequest, setDebugRequest] = useState<string | null>(null);
    const [debugResponse, setDebugResponse] = useState<string | null>(null);

    // Effect to update configuration when model changes
    useEffect(() => {
        const newConfig = getModelConfig(modelName);
        if (newConfig) {
            setSelectedConfig(newConfig);
            setGuidanceImages([]); // Clear guidance images when model changes
            const defaults = newConfig.defaults || {};
            
            const alchemySupported = newConfig.supports.alchemy || false;
            setAlchemy(alchemySupported);
            setPhotoReal(alchemySupported && (defaults.photoReal || false));

            setStyle(defaults.style || 'None');
            if (newConfig.supports.contrast) {
                setContrast(defaults.contrast || 1.0);
            }

            const supportedRatios = newConfig.supports.aspectRatios || ['1:1'];
            const defaultRatio = supportedRatios.includes('1:1') ? '1:1' : supportedRatios[0];
            setAspectRatio(defaultRatio);
        }
    }, [modelName]);

    useEffect(() => {
        const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio];
        if (dimensions) {
            setWidth(dimensions.width);
            setHeight(dimensions.height);
        }
    }, [aspectRatio]);

    useEffect(() => {
        if (!alchemy) {
            setPhotoReal(false);
        }
    }, [alchemy]);
    
    const pollForResult = useCallback(async (api: LeonardoAPI, generationId: string): Promise<GenerationResult> => {
        let attempts = 0;
        const maxAttempts = 30; 
        
        while (attempts < maxAttempts) {
            setStatus(`Polling for result... (Attempt ${attempts + 1})`);
            const response = await api.getGenerationById(generationId);
            setDebugResponse(`Polling Response:\n${JSON.stringify(response, null, 2)}`);

            const generation = response.generations_by_pk;
            if (generation?.status === 'COMPLETE') {
                return response;
            } else if (generation?.status === 'FAILED') {
                throw new Error('Generation failed.');
            }
            
            await new Promise(resolve => setTimeout(resolve, 10000));
            attempts++;
        }

        throw new Error('Polling timed out.');
    }, []);

    const handleImageUpload = async (file: File) => {
        const tempId = Date.now().toString() + file.name;
        const previewUrl = URL.createObjectURL(file);
        
        const supportedGuidance = selectedConfig?.supports.guidance ? Object.keys(selectedConfig.supports.guidance) : [];
        const supportedContextGuidance = selectedConfig?.supports.contextGuidance || [];
        const defaultGuidanceType = supportedGuidance.length > 0 ? supportedGuidance[0] : '';
        const defaultStrengthType = defaultGuidanceType ? GUIDANCE_STRENGTH_TYPES[defaultGuidanceType]?.[1] || 'Mid' : 'Mid';
        const defaultContextType = supportedContextGuidance.length > 0 ? supportedContextGuidance[0] : '';
        
        const newImage: GuidanceImage = {
            tempId, file, previewUrl, status: 'uploading',
            guidanceType: defaultGuidanceType,
            strengthType: defaultStrengthType,
            weight: 1.0,
            contextType: defaultContextType,
        };

        setGuidanceImages(prev => [...prev, newImage]);
        
        try {
            if (!apiKey) throw new Error('API Key is required to upload images.');
            const api = new LeonardoAPI(apiKey);
            const extension = file.name.split('.').pop();
            if (!extension) throw new Error('Could not determine file extension.');

            // Standard Presigned URL Upload Method
            setStatus('Uploading image...');
            console.log('Attempting presigned URL upload...');
            const uploadUrlResponse = await api.getInitImageUploadUrl(extension);
            const { id, fields: fieldsStr, url } = uploadUrlResponse.uploadInitImage;
            const fields = JSON.parse(fieldsStr);
            await api.uploadImageToS3(url, fields, file);
            
            console.log('Presigned URL upload successful (optimistic).');
            setStatus('Image upload successful.');

            if (!id) {
                throw new Error('Could not retrieve image ID after upload.');
            }

            setGuidanceImages(prev => prev.map(img => 
                img.tempId === tempId ? { ...img, status: 'ready', id } : img
            ));
        } catch (err: any) {
            console.error('Upload failed:', err);
            setGuidanceImages(prev => prev.map(img => 
                img.tempId === tempId ? { ...img, status: 'error', error: err.message || 'Upload failed' } : img
            ));
            setStatus('Image upload failed.');
        }
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            Array.from(e.target.files).forEach(handleImageUpload);
            e.target.value = ''; // Reset file input
        }
    };

    const removeGuidanceImage = (tempId: string) => {
        setGuidanceImages(prev => prev.filter(img => img.tempId !== tempId));
    };

    const updateGuidanceImage = (tempId: string, updates: Partial<GuidanceImage>) => {
        // If guidanceType is being updated, also reset strengthType to a valid default.
        if ('guidanceType' in updates && updates.guidanceType) {
            const newGuidanceType = updates.guidanceType;
            const validStrengths = GUIDANCE_STRENGTH_TYPES[newGuidanceType] || [];
            const newStrengthType = validStrengths.includes('Mid') ? 'Mid' : (validStrengths[0] || '');
            updates.strengthType = newStrengthType;
        }

        setGuidanceImages(prev => prev.map(img => 
            img.tempId === tempId ? { ...img, ...updates } : img
        ));
    };


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
        setDebugRequest(null);
        setDebugResponse(null);
        setStatus('Initializing generation...');

        try {
            const api = new LeonardoAPI(apiKey);
            
            const params: GenerationParams = {
                prompt, modelId: selectedConfig.id, width, height, num_images: 1,
            };

            if (selectedConfig.supports.alchemy) {
                params.alchemy = alchemy;
                if (alchemy) {
                    params.photoReal = photoReal;
                    if (style && style !== 'None') {
                        params.presetStyle = style.toUpperCase().replace(/\s/g, '_');
                    }
                }
            }
            if (selectedConfig.supports.contrast) {
                params.contrast = contrast;
            }
            
            if (selectedConfig.supports.contextGuidance && guidanceImages.length > 0) {
                const readyImages = guidanceImages.filter(img => img.status === 'ready' && img.id);
                if (readyImages.length > 0) {
                    params.contextImages = readyImages.map(img => ({
                        init_image_id: img.id!,
                        context: img.contextType!,
                    }));
                }
            } else if (selectedConfig.supports.guidance && guidanceImages.length > 0) {
                const readyImages = guidanceImages.filter(img => img.status === 'ready' && img.id);
                if (readyImages.length > 0) {
                    params.controlnets = readyImages.map((img): ControlNetParams => {
                        const guidanceConfig = selectedConfig.supports.guidance?.[img.guidanceType];
                        if (!guidanceConfig) {
                            throw new Error(`Invalid guidance type "${img.guidanceType}" for this model.`);
                        }
                        const { preprocessorId, usesWeight } = guidanceConfig;
                        
                        const baseControlNet = {
                            initImageId: img.id!,
                            initImageType: 'UPLOADED' as const,
                            preprocessorId,
                        };

                        if (usesWeight) {
                            return {
                                ...baseControlNet,
                                weight: img.weight,
                            };
                        } else {
                            return {
                                ...baseControlNet,
                                strengthType: img.strengthType,
                            };
                        }
                    });
                }
            }


            setStatus('Sending generation request...');
            setDebugRequest(JSON.stringify(params, null, 2));
            const initialResponse = await api.generateImage(params);

            const generationId = initialResponse.sdGenerationJob?.generationId;
            if (!generationId) {
                throw new Error('Failed to get generation ID from the initial response.');
            }
            setDebugResponse(`Initial Response:\n${JSON.stringify(initialResponse, null, 2)}`);
            
            const finalResult = await pollForResult(api, generationId);
            const imageUrl = finalResult.generations_by_pk?.generated_images?.[0]?.url;
            
            if (imageUrl) {
                setResultImageUrl(imageUrl);
                setStatus('Generation Complete!');
            } else {
                throw new Error('Generation completed, but no image URL was found.');
            }

        } catch (err: any) {
            const errorString = err.message || 'An unknown error occurred.';
            setError(errorString);
            setDebugResponse(`Error:\n${JSON.stringify(err, null, 2)}`);
            setStatus('Error occurred.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const supportedGuidance = selectedConfig?.supports.guidance ? Object.keys(selectedConfig.supports.guidance) : [];
    const supportedContextGuidance = selectedConfig?.supports.contextGuidance || [];

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
                        <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} aria-label="Image generation prompt" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="model">Model</label>
                        <select id="model" value={modelName} onChange={(e) => setModelName(e.target.value)} aria-label="Select generation model">
                            {imageModels.map(name => (<option key={name} value={name}>{name}</option>))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label htmlFor="aspect-ratio">Aspect Ratio ({width}x{height})</label>
                        <select id="aspect-ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} aria-label="Select aspect ratio" disabled={!selectedConfig?.supports.aspectRatios}>
                            {selectedConfig?.supports.aspectRatios?.map(ratio => (<option key={ratio} value={ratio}>{ratio}</option>))}
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
                                {IMAGE_GEN_STYLES.map(s => (<option key={s} value={s}>{s}</option>))}
                            </select>
                        </div>
                        </>
                    )}

                    {selectedConfig?.supports.contrast && (
                         <div className="form-group">
                            <label htmlFor="contrast">Contrast</label>
                            <select id="contrast" value={contrast} onChange={(e) => setContrast(parseFloat(e.target.value))} aria-label="Select contrast level">
                                {CONTRAST_VALUES.map(c => (<option key={c} value={c}>{c.toFixed(1)}</option>))}
                            </select>
                        </div>
                    )}
                </div>

                <div className="card">
                    <h2>Image Guidance</h2>
                    <div className="guidance-card-content">
                        {(supportedGuidance.length > 0 || supportedContextGuidance.length > 0) ? (
                            <>
                                <div className="guidance-upload-area">
                                    <input type="file" id="image-upload" multiple accept="image/png, image/jpeg" onChange={handleFileInputChange} style={{ display: 'none' }}/>
                                    <button type="button" onClick={() => document.getElementById('image-upload')?.click()} disabled={loading || !apiKey}>
                                        + Add Guidance Image
                                    </button>
                                </div>
                                {guidanceImages.length > 0 && (
                                    <div className="guidance-list">
                                        {guidanceImages.map((img) => {
                                            const isContextModel = supportedContextGuidance.length > 0;
                                            const guidanceConfig = selectedConfig?.supports.guidance?.[img.guidanceType];
                                            const guidanceUsesWeight = guidanceConfig?.usesWeight ?? true;

                                            return (
                                                <div key={img.tempId} className="guidance-item">
                                                    <div className="guidance-item-preview">
                                                        <img src={img.previewUrl} alt={img.file.name} />
                                                        {img.status !== 'ready' && (
                                                            <div className="guidance-item-status">
                                                                {img.status === 'uploading' && 'Uploading...'}
                                                                {img.status === 'error' && `Error: ${img.error}`}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="guidance-item-controls">
                                                        {isContextModel ? (
                                                            <div className="form-group">
                                                                <label htmlFor={`context-type-${img.tempId}`}>Context Type</label>
                                                                <select
                                                                    id={`context-type-${img.tempId}`}
                                                                    value={img.contextType}
                                                                    onChange={(e) => updateGuidanceImage(img.tempId, { contextType: e.target.value })}
                                                                    disabled={img.status !== 'ready'}
                                                                >
                                                                    {supportedContextGuidance.map(type => (
                                                                        <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="form-group">
                                                                    <label htmlFor={`guidance-type-${img.tempId}`}>Guidance Type</label>
                                                                    <select id={`guidance-type-${img.tempId}`} value={img.guidanceType} onChange={(e) => updateGuidanceImage(img.tempId, { guidanceType: e.target.value })} disabled={img.status !== 'ready'}>
                                                                        {supportedGuidance.map(type => (<option key={type} value={type}>{type}</option>))}
                                                                    </select>
                                                                </div>
                                                                {guidanceUsesWeight ? (
                                                                    <div className="form-group">
                                                                        <label>Weight: {img.weight.toFixed(2)}</label>
                                                                        <div className="slider-group">
                                                                            <input type="range" min="0" max="2" step="0.05" value={img.weight} onChange={(e) => updateGuidanceImage(img.tempId, { weight: parseFloat(e.target.value) })} disabled={img.status !== 'ready'} />
                                                                        </div>
                                                                    </div>
                                                                ) : (
                                                                    <div className="form-group">
                                                                        <label htmlFor={`strength-type-${img.tempId}`}>Strength Type</label>
                                                                        <select id={`strength-type-${img.tempId}`} value={img.strengthType} onChange={(e) => updateGuidanceImage(img.tempId, { strengthType: e.target.value })} disabled={img.status !== 'ready'}>
                                                                            {(GUIDANCE_STRENGTH_TYPES[img.guidanceType] || []).map(type => (<option key={type} value={type}>{type}</option>))}
                                                                        </select>
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                    <button type="button" className="remove-guidance-btn" onClick={() => removeGuidanceImage(img.tempId)} title="Remove Image">&times;</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        ) : (
                            <p>The selected model does not support Image Guidance.</p>
                        )}
                    </div>
                </div>


                <div className="card">
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
                 {(debugRequest || debugResponse) && (
                    <details className="debug-details">
                        <summary>Debug Information</summary>
                        <div className="debug-content">
                            {debugRequest && (
                                <div>
                                    <h4>API Request Payload</h4>
                                    <pre>{debugRequest}</pre>
                                </div>
                            )}
                            {debugResponse && (
                                <div>
                                    <h4>API Response</h4>
                                    <pre>{debugResponse}</pre>
                                </div>
                            )}
                        </div>
                    </details>
                )}
            </div>
        </>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);