import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { ShaderError, ShaderParam, VideoConfig, ScrollEffectType, ScrollParams } from '../types';
import { calculateUniformLayout, writeParamsToBuffer } from './ShaderParams';

// --- WebGPU Type Stubs ---
type GPUDevice = any;
type GPUCanvasContext = any;
type GPURenderPipeline = any;
type GPUBuffer = any;
type GPUBindGroup = any;
declare const GPUBufferUsage: any;
declare const GPUShaderStage: any;

const getErrorMessage = (err: any): string => {
  if (err === undefined) return "Undefined Error";
  if (err === null) return "Null Error";
  if (typeof err === 'string') return err;
  if (err.reason !== undefined && err.message !== undefined) return `Device Lost (${err.reason}): ${err.message}`;
  if (err.message !== undefined) return String(err.message);
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try { const json = JSON.stringify(err); if (json !== '{}') return json; } catch (e) {}
  return String(err);
};

export interface WebGPURendererRef {
  capture: (quality?: number) => void;
  startVideo: (config: VideoConfig) => void;
  stopVideo: () => void;
  loadTexture: (file: File) => void;
  toggleAudio: () => Promise<void>;
  updateScroll: (y: number) => void;
}

interface WebGPURendererProps {
  shaderCode: string;
  params: ShaderParam[]; 
  onParamsChange: (newParams: ShaderParam[]) => void;
  description?: string;
  onError: (error: ShaderError) => void;
  onClearError: () => void;
  onRecordProgress: (isRecording: boolean, timeLeft: number) => void;
  scrollEffect: ScrollEffectType;
  scrollParams: ScrollParams;
  textureScale: { x: number, y: number };
  textureOffset: { x: number, y: number };
}

const WebGPURenderer = forwardRef<WebGPURendererRef, WebGPURendererProps>(({ shaderCode, params, onParamsChange, description, onError, onClearError, onRecordProgress, scrollEffect, scrollParams, textureScale, textureOffset }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  
  const deviceRef = useRef<GPUDevice | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const uniformBufferRef = useRef<GPUBuffer | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const textureRef = useRef<any>(null); // Channel 0
  const samplerRef = useRef<any>(null); // Sampler
  
  const requestRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const isMountedRef = useRef<boolean>(true);
  const hasReportedErrorRef = useRef<boolean>(false);
  
  // Audio State
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const audioDataArrayRef = useRef<Uint8Array | null>(null);

  // Capture State
  const capturePendingRef = useRef<number>(0); 
  
  // Video Recording State
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingConfigRef = useRef<VideoConfig | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef<boolean>(false);
  const recordedFramesRef = useRef<number>(0); 
  const streamTrackRef = useRef<any>(null); 

  // Scroll State
  const scrollYRef = useRef<number>(0);
  const scrollEffectRef = useRef<ScrollEffectType>(scrollEffect);
  const scrollParamsRef = useRef<ScrollParams>(scrollParams);
  const textureScaleRef = useRef(textureScale);
  const textureOffsetRef = useRef(textureOffset);

  // Sync refs with props to avoid stale closures in render loop
  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { scrollEffectRef.current = scrollEffect; }, [scrollEffect]);
  useEffect(() => { scrollParamsRef.current = scrollParams; }, [scrollParams]);
  useEffect(() => { textureScaleRef.current = textureScale; }, [textureScale]);
  useEffect(() => { textureOffsetRef.current = textureOffset; }, [textureOffset]);

  const STANDARD_HEADER_SIZE = 48; 
  
  const cameraState = useRef({ theta: 0.0, phi: 0.0, radius: 4.5, isDragging: false, lastX: 0, lastY: 0 });
  const mouseState = useRef({ x: 0, y: 0, isDown: 0 });

  // --- HELPER: Texture Creation ---
  const createTextureFromImage = async (device: GPUDevice, source: ImageBitmap | HTMLCanvasElement) => {
    const texture = device.createTexture({
        size: [source.width, source.height, 1],
        format: 'rgba8unorm',
        usage: 0x04 | 0x02 | 0x01 | 0x10, // COPY_DST | TEXTURE_BINDING | COPY_SRC | RENDER_ATTACHMENT
    });
    device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        [source.width, source.height]
    );
    return texture;
  };
  
  // High-End Abstract Art Default Texture (Smoother)
  const createDefaultTexture = (device: GPUDevice) => {
      const size = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          // Smooth, High-End Gradient - Less Noisy
          const grd = ctx.createLinearGradient(0, 0, size, size);
          grd.addColorStop(0, '#0a0a0a');
          grd.addColorStop(1, '#1f1f1f'); 
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, size, size);
          
          // Soft Glow
          const rad = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
          rad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
          rad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = rad;
          ctx.fillRect(0, 0, size, size);

          // Minimal Tech Lines (Clean)
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, size/2); ctx.lineTo(size, size/2);
          ctx.moveTo(size/2, 0); ctx.lineTo(size/2, size);
          ctx.stroke();

          // Placeholder Text
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.font = 'bold 80px "Inter", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('NO TEXTURE', size/2, size/2);
      }
      return createTextureFromImage(device, canvas);
  };

  useImperativeHandle(ref, () => ({
    capture: (quality = 1) => {
      capturePendingRef.current = quality;
    },
    loadTexture: async (file: File) => {
        if (!deviceRef.current || !file) return;
        try {
            const bitmap = await createImageBitmap(file);
            
            // --- CV ENHANCEMENT PIPELINE ---
            // Process the uploaded image to normalize it for shader usage (clean it up).
            const canvas = document.createElement('canvas');
            const size = 1024; // Standardize to Power of 2 for better sampling/wrapping
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            if (ctx) {
                // 1. Resize & Draw
                ctx.drawImage(bitmap, 0, 0, size, size);
                
                // 2. CV Enhancement: Auto-Levels / Normalize Contrast
                // Shaders work best when textures utilize the full 0-1 dynamic range.
                const imageData = ctx.getImageData(0, 0, size, size);
                const data = imageData.data;
                
                let min = 255, max = 0;
                // Sample every 40th pixel for speed estimation of range
                for(let i=0; i<data.length; i+=40) {
                     const luma = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                     if(luma < min) min = luma;
                     if(luma > max) max = luma;
                }
                
                // If the image is washed out, stretch the contrast
                if (max > min) {
                    const range = max - min;
                    // Apply to all pixels
                    for(let i=0; i<data.length; i+=4) {
                        data[i] = ((data[i] - min) / range) * 255;     // R
                        data[i+1] = ((data[i+1] - min) / range) * 255; // G
                        data[i+2] = ((data[i+2] - min) / range) * 255; // B
                    }
                }
                
                ctx.putImageData(imageData, 0, 0);

                const texture = await createTextureFromImage(deviceRef.current, canvas);
                textureRef.current = texture;
                rebind(deviceRef.current);
            }
            bitmap.close();
        } catch (e) {
            console.error("Failed to load texture", e);
        }
    },
    toggleAudio: async () => {
        if (audioContextRef.current) {
            audioContextRef.current.suspend();
            audioContextRef.current = null;
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyzer = ctx.createAnalyser();
            analyzer.fftSize = 256;
            source.connect(analyzer);
            audioContextRef.current = ctx;
            analyzerRef.current = analyzer;
            audioDataArrayRef.current = new Uint8Array(analyzer.frequencyBinCount);
        } catch (e) {
            console.error("Audio init failed", e);
            alert("Could not access microphone.");
        }
    },
    startVideo: (config: VideoConfig) => {
        if (!canvasRef.current) return;
        recordingConfigRef.current = config;
        chunksRef.current = [];
        recordedFramesRef.current = 0;
        canvasRef.current.width = 1920;
        canvasRef.current.height = 1080;

        const stream = canvasRef.current.captureStream(0);
        const track = stream.getVideoTracks()[0];
        if (track && (track as any).requestFrame) {
             streamTrackRef.current = track;
        } else {
             const autoStream = canvasRef.current.captureStream(config.fps);
             recorderRef.current = new MediaRecorder(autoStream, { mimeType: 'video/webm' });
             streamTrackRef.current = null;
        }

        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8';

        if (!recorderRef.current) {
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: config.bitrate * 1000000 });
            recorderRef.current = recorder;
        }

        const recorder = recorderRef.current!;
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `cinematic_recording_${Date.now()}.webm`;
            a.click();
            URL.revokeObjectURL(url);
            isRecordingRef.current = false;
            streamTrackRef.current = null;
            onRecordProgress(false, 0);
        };
        recorder.start();
        recordingStartTimeRef.current = performance.now();
        isRecordingRef.current = true;
    },
    stopVideo: () => {
        if (recorderRef.current && recorderRef.current.state === 'recording') {
            recorderRef.current.stop();
        }
    },
    updateScroll: (y: number) => {
        scrollYRef.current = y * 0.001; // Normalize scale
    }
  }));

  const rebind = (device: GPUDevice) => {
      if (!pipelineRef.current || !uniformBufferRef.current || !textureRef.current || !samplerRef.current) return;
      
      const bindGroup = device.createBindGroup({
          layout: pipelineRef.current.getBindGroupLayout(0),
          entries: [
              { binding: 0, resource: { buffer: uniformBufferRef.current } },
              { binding: 1, resource: textureRef.current.createView() },
              { binding: 2, resource: samplerRef.current }
          ]
      });
      bindGroupRef.current = bindGroup;
  };

  const compilePipeline = async (device: GPUDevice, code: string, context: GPUCanvasContext) => {
      const format = (navigator as any).gpu.getPreferredCanvasFormat();
      
      const shaderModule = device.createShaderModule({ label: 'Main', code });
      const compilationInfo = await shaderModule.getCompilationInfo();
      if (compilationInfo.messages.length > 0) {
        let hasError = false;
        for (const msg of compilationInfo.messages) {
          if (msg.type === 'error') {
              hasError = true;
              onError({ type: 'compilation', message: getErrorMessage(msg.message), lineNum: msg.lineNum, linePos: msg.linePos });
          }
        }
        if (hasError) return;
      }
      onClearError();
      hasReportedErrorRef.current = false;

      const bindGroupLayout = device.createBindGroupLayout({ 
          entries: [
              { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' }},
              { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
              { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }
          ]
      });

      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: { module: shaderModule, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      pipelineRef.current = pipeline;
      
      const layout = calculateUniformLayout(paramsRef.current, STANDARD_HEADER_SIZE);
      rebind(device);
      
      // Resume loop if it was stopped
      if (!requestRef.current) {
          startTimeRef.current = performance.now();
          requestRef.current = requestAnimationFrame(render);
      }
  };

  // INITIAL SETUP
  useEffect(() => {
    isMountedRef.current = true;
    const initWebGPU = async () => {
      const gpu = (navigator as any).gpu;
      if (!gpu) { setIsSupported(false); onError({ type: 'compilation', message: "WebGPU not supported." }); return; }

      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) { setIsSupported(false); onError({ type: 'compilation', message: "No GPU adapter." }); return; }
        const device = await adapter.requestDevice();
        if (!isMountedRef.current) { device.destroy(); return; }
        deviceRef.current = device;

        device.lost.then((info: any) => { if (isMountedRef.current) onError({ type: 'runtime', message: getErrorMessage(info) }); });
        device.addEventListener('uncapturederror', (e: any) => { if (isMountedRef.current) onError({ type: 'runtime', message: getErrorMessage(e.error) }); });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('webgpu') as any;
        contextRef.current = context;
        const format = gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });

        // Buffer Init
        const uniformBuffer = device.createBuffer({ size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        uniformBufferRef.current = uniformBuffer;

        const defaultTex = await createDefaultTexture(device);
        textureRef.current = defaultTex;
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
        samplerRef.current = sampler;

        await compilePipeline(device, shaderCode, context);

        requestRef.current = requestAnimationFrame(render);
      } catch (err: any) { onError({ type: 'compilation', message: getErrorMessage(err) }); }
    };
    initWebGPU();
    return () => { isMountedRef.current = false; if (requestRef.current !== null) cancelAnimationFrame(requestRef.current); };
  }, []);

  // PIPELINE RELOAD
  useEffect(() => {
      if (deviceRef.current && contextRef.current) {
          compilePipeline(deviceRef.current, shaderCode, contextRef.current);
      }
  }, [shaderCode]); 

  const render = (time: number) => {
    const device = deviceRef.current;
    const context = contextRef.current;
    const pipeline = pipelineRef.current;
    const uniformBuffer = uniformBufferRef.current;
    const bindGroup = bindGroupRef.current;
    const canvas = canvasRef.current;

    // Safety checks
    if (!device || !context || !pipeline || !uniformBuffer || !bindGroup || !canvas) {
         requestRef.current = requestAnimationFrame(render);
         return;
    }
    
    if (hasReportedErrorRef.current) {
        requestRef.current = null;
        return;
    }

    let width, height;
    if (capturePendingRef.current > 0) {
        width = 3840; height = 2160;
        canvas.width = width; canvas.height = height;
    } else if (isRecordingRef.current) {
        width = 1920; height = 1080;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    } else {
        const dpr = window.devicePixelRatio || 1; 
        width = Math.floor(canvas.clientWidth * dpr);
        height = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    }

    if (width === 0 || height === 0) {
        requestRef.current = requestAnimationFrame(render);
        return;
    }

    let elapsedTime = (time - startTimeRef.current) * 0.001;
    let cameraTheta = cameraState.current.theta;
    let cameraPhi = cameraState.current.phi;
    let cameraRadius = cameraState.current.radius;
    
    // Use synced refs
    const currentParams = [...paramsRef.current];
    const currentScrollEffect = scrollEffectRef.current;
    const currentScrollParams = scrollParamsRef.current;
    const currentTextureScale = textureScaleRef.current;
    const currentTextureOffset = textureOffsetRef.current;

    if (isRecordingRef.current && recordingConfigRef.current) {
        const fps = recordingConfigRef.current.fps;
        elapsedTime = recordedFramesRef.current / fps;
        recordedFramesRef.current++;
        const duration = recordingConfigRef.current.duration;
        const progress = Math.min(1.0, elapsedTime / duration);
        const remaining = Math.max(0, duration - elapsedTime);
        onRecordProgress(true, remaining);

        const shot = recordingConfigRef.current.shotType;
        if (shot === 'orbit') { cameraTheta += elapsedTime * 0.5; }
        else if (shot === 'sweep') { cameraTheta += elapsedTime * 0.3; cameraPhi = 0.1; cameraRadius = 6.0; }
        else if (shot === 'dolly') { cameraRadius = 6.0 - (progress * 2.0); cameraTheta += elapsedTime * 0.1; }
        else if (shot === 'breathing') { cameraRadius = 5.0 + Math.sin(elapsedTime * 0.8) * 0.5; cameraTheta += elapsedTime * 0.2; }
        else if (shot === 'chaos') { cameraTheta += elapsedTime * 0.5; cameraPhi = Math.sin(elapsedTime * 2.0) * 0.5; cameraRadius = 4.0 + Math.cos(elapsedTime * 3.0) * 0.5; }

        if (recordingConfigRef.current.orchestrate) {
             const firstFloat = currentParams.findIndex(p => p.type === 'float');
             if (firstFloat !== -1) {
                 const p = { ...currentParams[firstFloat] } as any; 
                 p.value = p.min + (p.max - p.min) * (0.5 + 0.5 * Math.sin(elapsedTime));
                 currentParams[firstFloat] = p;
             }
        }
        if (elapsedTime >= duration) {
             if (recorderRef.current && recorderRef.current.state === 'recording') recorderRef.current.stop();
        }
    }

    const cx = cameraRadius * Math.cos(cameraPhi) * Math.sin(cameraTheta);
    const cy = cameraRadius * Math.sin(cameraPhi);
    const cz = cameraRadius * Math.cos(cameraPhi) * Math.cos(cameraTheta);
    
    const layout = calculateUniformLayout(currentParams, STANDARD_HEADER_SIZE);
    
    const uniformData = new Float32Array(512 / 4); // Fixed large buffer
    uniformData[0] = width; uniformData[1] = height; uniformData[2] = elapsedTime;
    uniformData[4] = cx; uniformData[5] = cy; uniformData[6] = cz;
    
    // NORMALIZE MOUSE INPUT (0.0 - 1.0)
    uniformData[8] = mouseState.current.x / width; 
    uniformData[9] = mouseState.current.y / height; 
    uniformData[10] = mouseState.current.isDown;
    
    writeParamsToBuffer(uniformData, currentParams, layout);

    let offset = layout.size / 4; 
    if (offset % 4 !== 0) offset += (4 - (offset % 4));

    // LightAz (f32)
    uniformData[offset] = 0.1; 
    uniformData[offset+1] = 0.6; 
    
    if (capturePendingRef.current > 0) uniformData[offset+2] = capturePendingRef.current;
    else if (isRecordingRef.current) uniformData[offset+2] = 2.0;
    else uniformData[offset+2] = 0.0;
    
    uniformData[offset+3] = recordingConfigRef.current?.postProcess.aberration || 0.0;

    let low = 0, mid = 0, high = 0, vol = 0;
    if (analyzerRef.current && audioDataArrayRef.current) {
        analyzerRef.current.getByteFrequencyData(audioDataArrayRef.current);
        const data = audioDataArrayRef.current;
        const bufferLength = data.length;
        const lowBound = Math.floor(bufferLength * 0.1);
        const midBound = Math.floor(bufferLength * 0.5);
        for(let i=0; i<bufferLength; i++) {
            const val = data[i] / 255.0;
            vol += val;
            if (i < lowBound) low += val; else if (i < midBound) mid += val; else high += val;
        }
        low /= lowBound; mid /= (midBound - lowBound); high /= (bufferLength - midBound); vol /= bufferLength;
    }
    uniformData[offset+4] = low; uniformData[offset+5] = mid; uniformData[offset+6] = high; uniformData[offset+7] = vol;
    
    uniformData[offset+8] = scrollYRef.current;
    
    let typeVal = 0;
    if (currentScrollEffect === 'twist') typeVal = 1;
    if (currentScrollEffect === 'fly') typeVal = 2;
    if (currentScrollEffect === 'chromatic') typeVal = 3;
    if (currentScrollEffect === 'liquify') typeVal = 4;
    if (currentScrollEffect === 'glitch') typeVal = 5;
    if (currentScrollEffect === 'blackhole') typeVal = 6;
    if (currentScrollEffect === 'kaleidoscope') typeVal = 7;
    uniformData[offset+9] = typeVal;

    uniformData[offset+10] = currentScrollParams.strength;
    uniformData[offset+11] = currentScrollParams.speed;
    
    uniformData[offset+12] = currentTextureScale.x;
    uniformData[offset+13] = currentTextureScale.y;

    uniformData[offset+14] = currentTextureOffset.x;
    uniformData[offset+15] = currentTextureOffset.y;

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    device.pushErrorScope('validation');

    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const renderPass = commandEncoder.beginRenderPass({ colorAttachments: [{ view: textureView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    renderPass.setPipeline(pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(6);
    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    device.popErrorScope().then((error: any) => {
        if (error && !hasReportedErrorRef.current) {
            hasReportedErrorRef.current = true;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            requestRef.current = null;
            onError({ type: 'validation', message: error.message || "Unknown validation error." });
        }
    }).catch((e: any) => console.error("Error scope failure", e));

    if (isRecordingRef.current && streamTrackRef.current && (streamTrackRef.current as any).requestFrame) {
        (streamTrackRef.current as any).requestFrame();
    }

    if (capturePendingRef.current > 0) {
        const link = document.createElement('a');
        const modeLabel = capturePendingRef.current === 2 ? 'ultra' : 'standard';
        link.download = `render_4k_${modeLabel}_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
        capturePendingRef.current = 0;
    }

    if (!hasReportedErrorRef.current) {
        requestRef.current = requestAnimationFrame(render);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => { 
      if (isRecordingRef.current) return; 
      canvasRef.current?.setPointerCapture(e.pointerId); 
      cameraState.current.isDragging = true; 
      cameraState.current.lastX = e.clientX; 
      cameraState.current.lastY = e.clientY; 
      mouseState.current.isDown = 1.0; 
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if(rect) { mouseState.current.x = e.clientX - rect.left; mouseState.current.y = e.clientY - rect.top; }
    if (cameraState.current.isDragging) {
      const dx = e.clientX - cameraState.current.lastX; const dy = e.clientY - cameraState.current.lastY;
      cameraState.current.lastX = e.clientX; cameraState.current.lastY = e.clientY;
      cameraState.current.theta -= dx * 0.005; // SLOWER ROTATION FOR PRODUCT SHOWCASE
      cameraState.current.phi += dy * 0.005;
      cameraState.current.phi = Math.max(-1.5, Math.min(1.5, cameraState.current.phi));
    }
  };
  const handlePointerUp = (e: React.PointerEvent) => { canvasRef.current?.releasePointerCapture(e.pointerId); cameraState.current.isDragging = false; mouseState.current.isDown = 0.0; };
  const handleWheel = (e: React.WheelEvent) => { cameraState.current.radius = Math.max(1.0, Math.min(50.0, cameraState.current.radius + e.deltaY * 0.005)); };

  if (!isSupported) return <div className="w-full h-full flex items-center justify-center bg-black text-red-500 font-mono"><p>WebGPU not supported.</p></div>;

  return (
        <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair touch-none" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp} onWheel={handleWheel} />
  );
});

export default WebGPURenderer;