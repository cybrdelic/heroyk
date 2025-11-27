import React, { useState, useEffect, useRef } from 'react';
import WebGPURenderer, { WebGPURendererRef } from './components/FireRenderer';
import { ErrorDisplay, DocumentationOverlay, MenuBar, MenuGroup, VideoExportOverlay, RecordingIndicator, ShaderEditor, GallerySidebar, TextureGizmo } from './components/UIComponents';
import { ShaderError, Preset, ShaderParam, LayoutMode, ScrollEffectType, ScrollParams } from './types';
import { PRESETS } from './presets';
import { LayoutOverlay } from './layouts';

const App: React.FC = () => {
  const [error, setError] = useState<ShaderError | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showAssetsTab, setShowAssetsTab] = useState(false);
  
  // Gallery & Layout State
  const [activePreset, setActivePreset] = useState<Preset>(PRESETS[0]);
  const [shaderCode, setShaderCode] = useState(PRESETS[0].shaderCode);
  const [params, setParams] = useState<ShaderParam[]>(PRESETS[0].params);
  const [activeLayout, setActiveLayout] = useState<LayoutMode>('clean');
  
  const [recordingStatus, setRecordingStatus] = useState({ isRecording: false, timeLeft: 0 });
  const [fps, setFps] = useState(0);
  const rendererRef = useRef<WebGPURendererRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // New Scroll Effect State
  const [activeScrollEffect, setActiveScrollEffect] = useState<ScrollEffectType>('none');
  const [scrollParams, setScrollParams] = useState<ScrollParams>({ strength: 0.5, speed: 0.5 });
  // Texture Scale Default: 0.7 (~45% bigger / zoomed in relative to 1.0)
  const [textureScale, setTextureScale] = useState({ x: 0.7, y: 0.7 });
  const [textureOffset, setTextureOffset] = useState({ x: 0.0, y: 0.0 });

  // Debounce Shader Updates
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCodeChange = (newCode: string) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
          setShaderCode(newCode);
      }, 500); 
  };
  
  const handlePresetSelect = (preset: Preset) => {
      setActivePreset(preset);
      setShaderCode(preset.shaderCode);
      setParams(preset.params); // This updates the UI sliders and sends new values to Renderer
  };

  useEffect(() => {
    let lastTime = performance.now();
    let frame = 0;
    const loop = () => {
      const now = performance.now();
      frame++;
      if (now - lastTime >= 1000) {
        setFps(frame);
        frame = 0;
        lastTime = now;
      }
      requestAnimationFrame(loop);
    };
    loop();
  }, []);

  // SCROLL LISTENER
  useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const handleScroll = () => {
          if (rendererRef.current) {
              rendererRef.current.updateScroll(container.scrollTop);
          }
      };
      
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
  }, [activeLayout]); // Re-bind if layout changes DOM structure

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          rendererRef.current?.loadTexture(file);
      }
  };

  // Menu Configuration
  const menus: MenuGroup[] = [
    {
        label: 'File',
        items: [
            { label: 'Reset Preset', action: () => handlePresetSelect(activePreset), shortcut: 'CMD+R' },
            { label: 'Load Texture...', action: () => fileInputRef.current?.click(), shortcut: 'CMD+O' },
            { label: 'Export Code', action: () => navigator.clipboard.writeText(shaderCode) },
        ]
    },
    {
        label: 'View',
        items: [
            { label: 'Toggle Code Editor', action: () => setShowEditor(!showEditor), shortcut: 'E' },
            { label: 'Documentation', action: () => setShowDocs(true), shortcut: 'F1' },
            { label: 'Toggle Fullscreen', action: () => {
                if (!document.fullscreenElement) document.documentElement.requestFullscreen();
                else if (document.exitFullscreen) document.exitFullscreen();
            }, shortcut: 'F11' }
        ]
    },
    {
        label: 'Render',
        items: [
            { label: 'Capture 4K (Standard)', action: () => rendererRef.current?.capture(1), shortcut: 'P' },
            { label: 'Capture 4K (Ultra + RT)', action: () => rendererRef.current?.capture(2), shortcut: 'SHIFT+P' },
            { label: 'Record Video...', action: () => setShowVideoModal(true), shortcut: 'V' }
        ]
    },
    {
        label: 'Audio',
        items: [
            { label: 'Start Microphone', action: () => rendererRef.current?.toggleAudio() },
        ]
    },
    {
        label: 'Help',
        items: [
            { label: 'About', action: () => alert('WebGPU Design Platform v2.0') }
        ]
    }
  ];

  return (
    <div className="w-screen h-screen relative bg-void overflow-hidden font-sans text-white select-none pt-10 antialiased">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileSelect} />
      
      {/* Top Menu Bar */}
      <MenuBar menus={menus} />
      
      {/* Gallery Sidebar */}
      <GallerySidebar 
        presets={PRESETS} 
        activePresetId={activePreset.id} 
        onSelect={handlePresetSelect} 
        activeLayout={activeLayout}
        onSelectLayout={setActiveLayout}
        params={params}
        setParams={setParams}
        activeScrollEffect={activeScrollEffect}
        onSelectScrollEffect={setActiveScrollEffect}
        scrollParams={scrollParams}
        setScrollParams={setScrollParams}
        textureScale={textureScale}
        setTextureScale={setTextureScale}
        textureOffset={textureOffset}
        setTextureOffset={setTextureOffset}
      />

      {/* Main Content Area */}
      <div className={`absolute inset-0 z-0 top-10 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showEditor ? 'left-[600px]' : 'left-0 md:left-80'}`}>
          {/* Layer 1: WebGPU Canvas (Fixed Background) */}
          <div className="absolute inset-0 z-0 pointer-events-auto">
              <WebGPURenderer 
                ref={rendererRef}
                shaderCode={shaderCode}
                params={params}
                onParamsChange={setParams}
                description={activePreset.description}
                onError={(e) => setError(e)}
                onClearError={() => setError(null)}
                onRecordProgress={(isRecording, timeLeft) => setRecordingStatus({ isRecording, timeLeft })}
                scrollEffect={activeScrollEffect}
                scrollParams={scrollParams}
                textureScale={textureScale}
                textureOffset={textureOffset}
              />
          </div>

          {/* Layer 3: Layout Overlay (Scrollable DOM) */}
          <LayoutOverlay mode={activeLayout} scrollRef={scrollContainerRef} />
      </div>

      {/* HUD Layer (Footer only) */}
      <div className={`absolute inset-0 z-20 pointer-events-none p-6 md:p-12 flex flex-col justify-end transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${showEditor ? 'left-[600px]' : 'left-0 md:left-80'}`}>
        <footer className="flex justify-between items-end">
            <div className="flex flex-col gap-1 pointer-events-auto opacity-50 hover:opacity-100 transition-opacity">
                 <div className="flex items-center gap-2 font-mono text-[10px] text-acid">
                    <span className="animate-pulse">●</span> {activePreset.name.toUpperCase()}_LOADED
                 </div>
                 <div className="font-mono text-[10px] text-white/40 tracking-widest">
                    {fps} FPS // {window.innerWidth}x{window.innerHeight}
                 </div>
            </div>
            <div className="text-right pointer-events-auto">
               <span className="text-[10px] font-mono text-white/30 tracking-widest uppercase">
                   Generated by Gemini 2.0 Flash
               </span>
            </div>
        </footer>
      </div>
      
      {/* Modals & Overlays */}
      <div className="pointer-events-auto">
           <ErrorDisplay error={error} onClose={() => setError(null)} />
           <DocumentationOverlay isOpen={showDocs} onClose={() => setShowDocs(false)} />
           <ShaderEditor 
                isOpen={showEditor} 
                onClose={() => setShowEditor(false)} 
                code={shaderCode} 
                onCodeChange={handleCodeChange} 
                error={error}
           />
           <VideoExportOverlay 
                isOpen={showVideoModal} 
                onClose={() => setShowVideoModal(false)}
                onStartRecord={(config) => rendererRef.current?.startVideo(config)}
           />
           <RecordingIndicator 
                isRecording={recordingStatus.isRecording} 
                timeLeft={recordingStatus.timeLeft} 
                onStop={() => rendererRef.current?.stopVideo()}
           />
      </div>
    </div>
  );
};

export default App;