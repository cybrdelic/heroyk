

import React, { useState, useEffect, useRef } from 'react';
import { ShaderError, VideoConfig, ShotType, Preset, LayoutMode, ShaderParam, ScrollEffectType, ScrollParams } from '../types';
import Editor, { useMonaco, Monaco } from '@monaco-editor/react';
import { ShaderControls } from './ShaderParams';

// --- Types ---
export interface MenuItem {
    label: string;
    action: () => void;
    shortcut?: string;
}

export interface MenuGroup {
    label: string;
    items: MenuItem[];
}

// --- GIZMO ---
interface TextureGizmoProps {
    scale: { x: number, y: number };
    offset: { x: number, y: number };
    onChange: (scale: { x: number, y: number }, offset: { x: number, y: number }) => void;
}

export const TextureGizmo: React.FC<TextureGizmoProps> = ({ scale, offset, onChange }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const startPos = useRef({ x: 0, y: 0 });
    const startVal = useRef({ scale: { ...scale }, offset: { ...offset } });

    // Center of screen
    const [center, setCenter] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    useEffect(() => {
        const handleResize = () => setCenter({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handlePointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        
        startPos.current = { x: e.clientX, y: e.clientY };
        startVal.current = { scale: { ...scale }, offset: { ...offset } };
        
        if (mode === 'move') setIsDragging(true);
        else setIsResizing(true);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging && !isResizing) return;
        e.preventDefault();
        e.stopPropagation();

        const dx = e.clientX - startPos.current.x;
        const dy = e.clientY - startPos.current.y;

        if (isDragging) {
            // Drag moves offset. 100px = 0.5 UV unit
            const sensitivity = 0.002;
            onChange(startVal.current.scale, {
                x: startVal.current.offset.x - dx * sensitivity,
                y: startVal.current.offset.y - dy * sensitivity
            });
        }

        if (isResizing) {
            // Resize scales. Pulling away makes box bigger -> Scale smaller (Zoom In)
            // Pulling in makes box smaller -> Scale larger (Zoom Out / Tile)
            const sensitivity = 0.01;
            const factor = 1.0 - (dx + dy) * sensitivity; // Simplified uniform scale interaction
            const newScale = Math.max(0.1, Math.min(10.0, startVal.current.scale.x * factor));
            
            onChange({ x: newScale, y: newScale }, startVal.current.offset);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        setIsDragging(false);
        setIsResizing(false);
    };

    // Visualization: Box size inversely proportional to scale. Scale 1 = 200px. Scale 2 = 100px.
    // Limit box size for usability.
    const boxSize = Math.max(50, Math.min(600, 200 / ((scale.x + scale.y) / 2)));

    return (
        <div className="absolute inset-0 pointer-events-none z-50 flex items-center justify-center">
            {/* Guide Text */}
            <div className="absolute top-24 bg-black/50 backdrop-blur px-4 py-2 rounded text-xs text-acid font-mono border border-acid/20">
                DRAG CENTER TO MOVE • DRAG CORNERS TO SCALE
            </div>

            <div 
                className="relative border-2 border-acid border-dashed bg-acid/5 pointer-events-auto cursor-move group"
                style={{ 
                    width: boxSize, 
                    height: boxSize,
                    transform: `translate(${-offset.x * 100}px, ${-offset.y * 100}px)` // Visualizing offset roughly
                }}
                onPointerDown={(e) => handlePointerDown(e, 'move')}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                {/* Center Crosshair */}
                <div className="absolute inset-0 flex items-center justify-center opacity-50">
                    <div className="w-4 h-0.5 bg-acid"></div>
                    <div className="h-4 w-0.5 bg-acid absolute"></div>
                </div>

                {/* Handles */}
                <div className="absolute -top-2 -left-2 w-4 h-4 bg-acid border border-white cursor-nwse-resize" onPointerDown={(e) => handlePointerDown(e, 'resize')}></div>
                <div className="absolute -top-2 -right-2 w-4 h-4 bg-acid border border-white cursor-nesw-resize" onPointerDown={(e) => handlePointerDown(e, 'resize')}></div>
                <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-acid border border-white cursor-nesw-resize" onPointerDown={(e) => handlePointerDown(e, 'resize')}></div>
                <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-acid border border-white cursor-nwse-resize" onPointerDown={(e) => handlePointerDown(e, 'resize')}></div>
            </div>
        </div>
    );
};

// --- GALLERY SIDEBAR ---
interface GallerySidebarProps {
    presets: Preset[];
    activePresetId: string;
    onSelect: (preset: Preset) => void;
    activeLayout: LayoutMode;
    onSelectLayout: (mode: LayoutMode) => void;
    params: ShaderParam[];
    setParams: (params: ShaderParam[]) => void;
    activeScrollEffect: ScrollEffectType;
    onSelectScrollEffect: (effect: ScrollEffectType) => void;
    scrollParams: ScrollParams;
    setScrollParams: (params: ScrollParams) => void;
    textureScale: { x: number, y: number };
    setTextureScale: (scale: { x: number, y: number }) => void;
    textureOffset: { x: number, y: number };
    setTextureOffset: (offset: { x: number, y: number }) => void;
}

export const GallerySidebar: React.FC<GallerySidebarProps> = ({ presets, activePresetId, onSelect, activeLayout, onSelectLayout, params, setParams, activeScrollEffect, onSelectScrollEffect, scrollParams, setScrollParams, textureScale, setTextureScale, textureOffset, setTextureOffset }) => {
    const [tab, setTab] = useState<'presets' | 'layouts' | 'effects' | 'tuning' | 'assets'>('presets');

    return (
        <div className="fixed top-10 left-0 bottom-0 w-24 md:w-80 bg-black border-r border-white/10 z-20 flex flex-col">
            {/* TABS */}
            <div className="flex border-b border-white/10 bg-black/50 backdrop-blur-md overflow-x-auto scrollbar-hide">
                <button onClick={() => setTab('presets')} className={`flex-1 min-w-[60px] py-4 text-[10px] font-mono uppercase tracking-widest relative ${tab === 'presets' ? 'text-white bg-white/5' : 'text-gray-500 hover:text-white'}`}>
                    Shaders
                    {tab === 'presets' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-acid shadow-[0_0_10px_#ccff00]"></div>}
                </button>
                <div className="w-px bg-white/10 my-3"></div>
                <button onClick={() => setTab('layouts')} className={`flex-1 min-w-[60px] py-4 text-[10px] font-mono uppercase tracking-widest relative ${tab === 'layouts' ? 'text-white bg-white/5' : 'text-gray-500 hover:text-white'}`}>
                    Layouts
                    {tab === 'layouts' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 shadow-[0_0_10px_#3b82f6]"></div>}
                </button>
                <div className="w-px bg-white/10 my-3"></div>
                 <button onClick={() => setTab('effects')} className={`flex-1 min-w-[60px] py-4 text-[10px] font-mono uppercase tracking-widest relative ${tab === 'effects' ? 'text-white bg-white/5' : 'text-gray-500 hover:text-white'}`}>
                    Effects
                    {tab === 'effects' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500 shadow-[0_0_10px_#ec4899]"></div>}
                </button>
                <div className="w-px bg-white/10 my-3"></div>
                <button onClick={() => setTab('tuning')} className={`flex-1 min-w-[60px] py-4 text-[10px] font-mono uppercase tracking-widest relative ${tab === 'tuning' ? 'text-white bg-white/5' : 'text-gray-500 hover:text-white'}`}>
                    Tuning
                    {tab === 'tuning' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500 shadow-[0_0_10px_#a855f7]"></div>}
                </button>
                <div className="w-px bg-white/10 my-3"></div>
                <button onClick={() => setTab('assets')} className={`flex-1 min-w-[60px] py-4 text-[10px] font-mono uppercase tracking-widest relative ${tab === 'assets' ? 'text-white bg-white/5' : 'text-gray-500 hover:text-white'}`}>
                    Assets
                    {tab === 'assets' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-500 shadow-[0_0_10px_#06b6d4]"></div>}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                {tab === 'presets' && presets.map(preset => (
                    <button 
                        key={preset.id} 
                        onClick={() => onSelect(preset)}
                        className={`w-full text-left p-2 rounded border transition-all duration-300 group relative overflow-hidden ${activePresetId === preset.id ? 'border-acid bg-acid/5 shadow-[0_0_20px_rgba(204,255,0,0.1)]' : 'border-white/10 hover:border-white/30 hover:bg-white/5'}`}
                    >
                        <div className={`h-16 md:h-24 w-full mb-3 bg-gradient-to-br transition-opacity rounded-sm overflow-hidden relative ${activePresetId === preset.id ? 'opacity-100' : 'opacity-60 group-hover:opacity-80'}`} 
                             style={{ 
                                 backgroundImage: preset.id === 'chrome' ? 'linear-gradient(135deg, #eee, #999)' : 
                                                  preset.id === 'obsidian' ? 'linear-gradient(to bottom, #000, #1a1a2e)' : 
                                                  preset.id === 'gold' ? 'linear-gradient(to bottom right, #DAA520, #8B4513)' :
                                                  preset.id === 'core' ? 'linear-gradient(135deg, #e0f2fe, #0ea5e9)' :
                                                  preset.id === 'card' ? 'linear-gradient(45deg, #333, #666)' : 'linear-gradient(120deg, #1e1b4b, #312e81)' 
                             }}
                        >
                            <div className="absolute inset-0 flex items-center justify-center">
                                 {preset.id === 'chrome' && <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white to-gray-400 border border-white/50 group-hover:scale-110 transition-transform"></div>}
                                 {preset.id === 'obsidian' && <div className="w-8 h-8 rotate-45 border-2 border-blue-500/50 bg-black/50 group-hover:rotate-90 transition-transform duration-700"></div>}
                                 {preset.id === 'gold' && <div className="w-12 h-6 rounded-full bg-yellow-500/30 blur-md group-hover:blur-lg transition-all"></div>}
                                 {preset.id === 'card' && <div className="w-8 h-5 border border-white/50 bg-white/10 backdrop-blur-md group-hover:scale-110 transition-transform"></div>}
                            </div>
                        </div>
                        <div className="hidden md:block px-1">
                            <div className="flex justify-between items-center mb-1.5">
                                <div className={`text-xs font-bold uppercase tracking-wider ${activePresetId === preset.id ? 'text-white' : 'text-gray-400'}`}>{preset.name}</div>
                            </div>
                            <div className="flex gap-1 flex-wrap">
                                {preset.tags.map(tag => (
                                    <span key={tag} className="text-[8px] px-1.5 py-0.5 border border-white/10 rounded-sm text-gray-500 uppercase bg-black/50">{tag}</span>
                                ))}
                            </div>
                        </div>
                    </button>
                ))}

                {tab === 'layouts' && (
                    <>
                        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1 mb-2 mt-2">Overlay Type</div>
                        <button onClick={() => onSelectLayout('clean')} className={`w-full text-left p-4 rounded border transition-all ${activeLayout === 'clean' ? 'border-blue-500 bg-blue-500/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-white/10 text-gray-400 hover:border-white/40 hover:bg-white/5'} group`}>
                            <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold uppercase">No Overlay</span><div className="w-2 h-2 rounded-full border border-gray-500 group-hover:bg-white transition-colors"></div></div>
                            <div className="text-[10px] text-gray-500 group-hover:text-gray-400">Pure canvas view.</div>
                        </button>
                        <button onClick={() => onSelectLayout('center')} className={`w-full text-left p-4 rounded border transition-all ${activeLayout === 'center' ? 'border-blue-500 bg-blue-500/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-white/10 text-gray-400 hover:border-white/40 hover:bg-white/5'} group`}>
                             <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold uppercase">Centered Hero</span><div className="flex gap-1"><div className="w-2 h-2 border border-gray-500"></div></div></div>
                        </button>
                        <button onClick={() => onSelectLayout('split')} className={`w-full text-left p-4 rounded border transition-all ${activeLayout === 'split' ? 'border-blue-500 bg-blue-500/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-white/10 text-gray-400 hover:border-white/40 hover:bg-white/5'} group`}>
                            <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold uppercase">Split Screen</span><div className="flex gap-px"><div className="w-1 h-2 bg-gray-600"></div><div className="w-1 h-2 border border-gray-600"></div></div></div>
                        </button>
                        <button onClick={() => onSelectLayout('cards')} className={`w-full text-left p-4 rounded border transition-all ${activeLayout === 'cards' ? 'border-blue-500 bg-blue-500/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.2)]' : 'border-white/10 text-gray-400 hover:border-white/40 hover:bg-white/5'} group`}>
                            <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold uppercase">Glass Grid</span><div className="grid grid-cols-2 gap-px w-3"><div className="h-1 bg-gray-600"></div><div className="h-1 bg-gray-600"></div><div className="h-1 bg-gray-600"></div><div className="h-1 bg-gray-600"></div></div></div>
                        </button>
                        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1 mb-2 mt-6">Interaction</div>
                        <button onClick={() => onSelectLayout('scroll')} className={`w-full text-left p-4 rounded border transition-all ${activeLayout === 'scroll' ? 'border-acid bg-acid/10 text-white shadow-[0_0_15px_rgba(204,255,0,0.2)]' : 'border-white/10 text-gray-400 hover:border-white/40 hover:bg-white/5'} group`}>
                            <div className="flex items-center justify-between mb-1"><span className="text-xs font-bold uppercase text-acid">Long Scroll</span><svg className="w-3 h-3 text-acid" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg></div>
                            <div className="text-[10px] text-gray-400 leading-tight mt-2">Tests <code className="text-acid">u.scrollY</code> interaction.</div>
                        </button>
                    </>
                )}

                {tab === 'effects' && (
                    <>
                         <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1 mb-2 mt-2">Scroll Behavior</div>
                         <div className="space-y-2">
                             {[
                                 { id: 'none', label: 'None', desc: 'Static camera.', p1: 'N/A', p2: 'N/A' },
                                 { id: 'glitch', label: 'VRAM Glitch', desc: 'Corrupt Buffer Simulation.', p1: 'Corruption', p2: 'Noise Freq' },
                                 { id: 'blackhole', label: 'Event Horizon', desc: 'Einstein Ring Lensing.', p1: 'Mass', p2: 'Accretion' },
                                 { id: 'kaleidoscope', label: 'Kaleidoscope', desc: 'Polar Domain Folding.', p1: 'Symmetry', p2: 'Rotation' },
                                 { id: 'twist', label: 'Geo Twist', desc: 'DNA Vortex distortion.', p1: 'Distortion', p2: 'Freq' },
                                 { id: 'fly', label: 'Hyperspace', desc: 'Warp Speed + Stars.', p1: 'Velocity', p2: 'FOV' },
                                 { id: 'chromatic', label: 'RGB Shift', desc: 'Spectral Channel Split.', p1: 'Split', p2: 'N/A' },
                                 { id: 'liquify', label: 'Liquify', desc: 'FBM Fluid Melt.', p1: 'Melt', p2: 'Turbulence' },
                             ].map((effect) => (
                                 <div key={effect.id} className="space-y-2">
                                     <button 
                                        onClick={() => onSelectScrollEffect(effect.id as ScrollEffectType)}
                                        className={`w-full text-left p-4 rounded border transition-all ${activeScrollEffect === effect.id ? 'border-pink-500 bg-pink-500/10 text-white shadow-[0_0_15px_rgba(236,72,153,0.2)]' : 'border-white/10 text-gray-400 hover:border-white/40 hover:bg-white/5'} group`}
                                     >
                                         <div className="flex items-center justify-between mb-1">
                                             <span className="text-xs font-bold uppercase">{effect.label}</span>
                                             <div className={`w-2 h-2 rounded-full border ${activeScrollEffect === effect.id ? 'bg-pink-500 border-pink-500' : 'border-gray-500'}`}></div>
                                         </div>
                                         <div className="text-[10px] text-gray-500 group-hover:text-gray-400">{effect.desc}</div>
                                     </button>

                                     {/* Effect-Specific Parameters */}
                                     {activeScrollEffect === effect.id && effect.id !== 'none' && (
                                         <div className="pl-4 pr-2 py-2 border-l border-pink-500/30 space-y-4 animate-fade-in-up bg-black/20">
                                              <div className="space-y-1">
                                                  <div className="flex justify-between text-[10px] uppercase font-mono text-pink-400"><span>{effect.p1}</span><span>{scrollParams.strength.toFixed(2)}</span></div>
                                                  <input 
                                                    type="range" min="0" max="1" step="0.01" 
                                                    value={scrollParams.strength} 
                                                    onChange={(e) => setScrollParams({...scrollParams, strength: parseFloat(e.target.value)})}
                                                    className="w-full accent-pink-500"
                                                  />
                                              </div>
                                              {effect.p2 !== 'N/A' && (
                                                  <div className="space-y-1">
                                                      <div className="flex justify-between text-[10px] uppercase font-mono text-pink-400"><span>{effect.p2}</span><span>{scrollParams.speed.toFixed(2)}</span></div>
                                                      <input 
                                                        type="range" min="0" max="1" step="0.01" 
                                                        value={scrollParams.speed} 
                                                        onChange={(e) => setScrollParams({...scrollParams, speed: parseFloat(e.target.value)})}
                                                        className="w-full accent-pink-500"
                                                      />
                                                  </div>
                                              )}
                                         </div>
                                     )}
                                 </div>
                             ))}
                         </div>
                    </>
                )}

                {tab === 'tuning' && (
                    <div className="p-2 pt-4">
                        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1 mb-6">Real-Time Parameters</div>
                        <ShaderControls params={params} setParams={setParams} />
                    </div>
                )}
                
                {tab === 'assets' && (
                    <div className="p-2 pt-4">
                        <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1 mb-6">Texture Management</div>
                        <div className="p-6 border-2 border-dashed border-white/20 rounded-lg hover:border-cyan-500 hover:bg-cyan-500/5 transition-colors cursor-pointer group flex flex-col items-center justify-center text-center gap-4" onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}>
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-gray-500 group-hover:text-cyan-500 group-hover:scale-110 transition-all">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-white mb-1">Upload Texture</div>
                                <div className="text-[10px] text-gray-500">JPG, PNG, WEBP supported.</div>
                            </div>
                        </div>
                        <div className="mt-8 space-y-6">
                             <div>
                                 <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1 mb-4">Current Asset</div>
                                 <div className="aspect-square w-full bg-black border border-white/10 rounded overflow-hidden relative group">
                                     <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20" 
                                          style={{ 
                                              backgroundSize: `${50 * (1/textureScale.x)}% ${50 * (1/textureScale.y)}%`, // Preview logic inverted for tiling visuals
                                              backgroundPosition: `${textureOffset.x * 100}% ${textureOffset.y * 100}%` 
                                          }}>
                                     </div>
                                     <div className="absolute bottom-2 right-2 text-[10px] bg-black/50 px-2 rounded text-gray-400">Default</div>
                                 </div>
                                 <div className="text-[10px] text-acid mt-2 text-center animate-pulse">
                                     GIZMO ACTIVE ON CANVAS
                                 </div>
                             </div>

                             <div className="space-y-4">
                                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1">Tiling (Scale)</div>
                                  <div className="grid grid-cols-2 gap-4">
                                      <div>
                                          <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>X</span><span>{textureScale.x.toFixed(2)}</span></div>
                                          <input type="range" min="0.1" max="5.0" step="0.1" value={textureScale.x} onChange={e => setTextureScale({...textureScale, x: parseFloat(e.target.value)})} className="w-full accent-cyan-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"/>
                                      </div>
                                      <div>
                                          <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Y</span><span>{textureScale.y.toFixed(2)}</span></div>
                                          <input type="range" min="0.1" max="5.0" step="0.1" value={textureScale.y} onChange={e => setTextureScale({...textureScale, y: parseFloat(e.target.value)})} className="w-full accent-cyan-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"/>
                                      </div>
                                  </div>
                             </div>

                             <div className="space-y-4">
                                  <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest px-1">Offset (Pos)</div>
                                  <div className="grid grid-cols-2 gap-4">
                                      <div>
                                          <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>X</span><span>{textureOffset.x.toFixed(2)}</span></div>
                                          <input type="range" min="-2.0" max="2.0" step="0.01" value={textureOffset.x} onChange={e => setTextureOffset({...textureOffset, x: parseFloat(e.target.value)})} className="w-full accent-cyan-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"/>
                                      </div>
                                      <div>
                                          <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Y</span><span>{textureOffset.y.toFixed(2)}</span></div>
                                          <input type="range" min="-2.0" max="2.0" step="0.01" value={textureOffset.y} onChange={e => setTextureOffset({...textureOffset, y: parseFloat(e.target.value)})} className="w-full accent-cyan-500 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"/>
                                      </div>
                                  </div>
                             </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- ERROR DISPLAY ---
interface ErrorDisplayProps {
    error: ShaderError | null;
    onClose: () => void;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onClose }) => {
    if (!error) return null;
    return (
        <div className="fixed bottom-4 right-4 max-w-md bg-red-900/90 border border-red-500 text-white p-4 rounded shadow-2xl z-50 animate-fade-in-up font-mono text-xs">
            <div className="flex justify-between items-start mb-2">
                <span className="font-bold uppercase text-red-300">Shader Error: {error.type}</span>
                <button onClick={onClose} className="text-red-300 hover:text-white">✕</button>
            </div>
            <div className="mb-2 whitespace-pre-wrap">{error.message}</div>
            {error.lineNum !== undefined && <div className="text-white/50">Line: {error.lineNum}</div>}
        </div>
    );
};

// --- DOCUMENTATION ---
interface DocumentationOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}
export const DocumentationOverlay: React.FC<DocumentationOverlayProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-gray-900 border border-white/10 max-w-2xl w-full max-h-[80vh] overflow-y-auto p-8 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-2xl font-bold mb-6 text-white font-mono">Documentation</h2>
                <div className="space-y-6 text-gray-300 text-sm leading-relaxed">
                   <p>Welcome to the WebGPU Kinetic Shader playground. This tool allows you to create real-time, raymarched scenes using pure WGSL code.</p>
                   
                   <h3 className="text-white font-bold mt-4">Uniforms</h3>
                   <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
                       <li>u.resolution (vec2f) - Canvas size</li>
                       <li>u.time (f32) - Elapsed time in seconds</li>
                       <li>u.mouse (vec4f) - Mouse coords (xy), Click (z), Scroll (w)</li>
                       <li>u.cameraPos (vec4f) - Camera position</li>
                       <li>u.audio (vec4f) - Audio levels (Low, Mid, High, Vol)</li>
                       <li>u.scrollY (f32) - Normalized scroll position (0-1)</li>
                   </ul>

                   <h3 className="text-white font-bold mt-4">Shortcuts</h3>
                   <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
                       <li>CTRL+S - Compile Shader (Auto-compiles on type)</li>
                       <li>CTRL+R - Reset Camera</li>
                       <li>P - Capture Screenshot</li>
                   </ul>
                </div>
                <button onClick={onClose} className="mt-8 px-6 py-2 bg-white text-black font-mono text-xs font-bold uppercase rounded hover:bg-gray-200">Close</button>
            </div>
        </div>
    );
};

// --- MENU BAR ---
interface MenuBarProps {
    menus: MenuGroup[];
}
export const MenuBar: React.FC<MenuBarProps> = ({ menus }) => {
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpenMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="fixed top-0 left-0 right-0 h-10 bg-black border-b border-white/10 z-50 flex items-center px-4 select-none" ref={menuRef}>
            <div className="font-bold tracking-tight mr-6 text-sm">GENAI<span className="text-acid">.GPU</span></div>
            <div className="flex gap-1 h-full items-center">
                {menus.map(group => (
                    <div key={group.label} className="relative h-full flex items-center">
                        <button 
                            className={`px-3 py-1 text-xs font-mono uppercase hover:bg-white/10 rounded transition-colors ${openMenu === group.label ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                            onClick={() => setOpenMenu(openMenu === group.label ? null : group.label)}
                        >
                            {group.label}
                        </button>
                        {openMenu === group.label && (
                            <div className="absolute top-full left-0 w-48 bg-gray-900 border border-white/10 shadow-xl rounded-b-md overflow-hidden py-1">
                                {group.items.map((item, idx) => (
                                    <button 
                                        key={idx} 
                                        className="w-full text-left px-4 py-2 text-xs text-gray-300 hover:bg-blue-600 hover:text-white flex justify-between group"
                                        onClick={() => { item.action(); setOpenMenu(null); }}
                                    >
                                        <span>{item.label}</span>
                                        {item.shortcut && <span className="text-gray-600 group-hover:text-blue-200 text-[10px]">{item.shortcut}</span>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- VIDEO EXPORT OVERLAY ---
interface VideoExportOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    onStartRecord: (config: VideoConfig) => void;
}

export const VideoExportOverlay: React.FC<VideoExportOverlayProps> = ({ isOpen, onClose, onStartRecord }) => {
    const [config, setConfig] = useState<VideoConfig>({
        duration: 5,
        fps: 60,
        bitrate: 20,
        shotType: 'orbit',
        orchestrate: true,
        postProcess: { grain: 0.05, aberration: 0.0 },
        format: 'webm'
    });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
             <div className="bg-gray-900 border border-white/10 max-w-lg w-full p-8 rounded-xl shadow-2xl">
                <h2 className="text-xl font-bold mb-6 text-white font-mono uppercase border-b border-white/10 pb-4">Export Video</h2>
                
                <div className="space-y-4 mb-8">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] uppercase text-gray-500 mb-1">Duration (Sec)</label>
                            <input type="number" value={config.duration} onChange={e => setConfig({...config, duration: Number(e.target.value)})} className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded focus:border-acid outline-none" />
                        </div>
                        <div>
                            <label className="block text-[10px] uppercase text-gray-500 mb-1">FPS</label>
                            <select value={config.fps} onChange={e => setConfig({...config, fps: Number(e.target.value)})} className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded focus:border-acid outline-none">
                                <option value={30}>30 FPS</option>
                                <option value={60}>60 FPS</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] uppercase text-gray-500 mb-1">Camera Movement</label>
                        <select value={config.shotType} onChange={e => setConfig({...config, shotType: e.target.value as ShotType})} className="w-full bg-black border border-white/20 p-2 text-sm text-white rounded focus:border-acid outline-none">
                            <option value="orbit">Simple Orbit</option>
                            <option value="sweep">Cinematic Sweep</option>
                            <option value="dolly">Slow Dolly Zoom</option>
                            <option value="breathing">Breathing Still</option>
                            <option value="chaos">Chaos Handheld</option>
                        </select>
                    </div>
                    
                    <div className="flex items-center gap-2 pt-2">
                        <input type="checkbox" checked={config.orchestrate} onChange={e => setConfig({...config, orchestrate: e.target.checked})} className="accent-acid"/>
                        <span className="text-xs text-gray-300">Auto-animate parameters</span>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-xs font-mono uppercase text-gray-400 hover:text-white">Cancel</button>
                    <button onClick={() => { onStartRecord(config); onClose(); }} className="px-6 py-2 bg-acid text-black font-bold text-xs font-mono uppercase rounded hover:bg-white transition-colors">Start Render</button>
                </div>
             </div>
        </div>
    );
};

// --- RECORDING INDICATOR ---
interface RecordingIndicatorProps {
    isRecording: boolean;
    timeLeft: number;
    onStop: () => void;
}
export const RecordingIndicator: React.FC<RecordingIndicatorProps> = ({ isRecording, timeLeft, onStop }) => {
    if (!isRecording) return null;
    return (
        <div className="fixed top-14 right-4 bg-red-900/90 border border-red-500 text-white px-4 py-2 rounded-full flex items-center gap-3 z-50 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.5)]">
            <div className="w-2 h-2 bg-white rounded-full"></div>
            <span className="font-mono text-xs font-bold">REC {timeLeft.toFixed(1)}s</span>
            <button onClick={onStop} className="ml-2 w-4 h-4 bg-white hover:bg-gray-200 mask mask-square"></button>
        </div>
    );
};

// --- SHADER EDITOR ---
interface ShaderEditorProps {
    isOpen: boolean;
    onClose: () => void;
    code: string;
    onCodeChange: (newCode: string) => void;
    error: ShaderError | null;
}
export const ShaderEditor: React.FC<ShaderEditorProps> = ({ isOpen, onClose, code, onCodeChange, error }) => {
    return (
        <div className={`fixed top-10 left-0 bottom-0 w-[600px] bg-[#1e1e1e] border-r border-white/10 z-30 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-2xl flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex justify-between items-center px-4 py-2 bg-[#252526] border-b border-black">
                <span className="text-xs font-mono text-gray-400 uppercase">main.wgsl</span>
                <div className="flex items-center gap-4">
                    {error && <span className="text-xs text-red-400 flex items-center gap-1">● Error</span>}
                    <button onClick={onClose} className="text-gray-500 hover:text-white">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
            <div className="flex-1 relative">
                <Editor 
                    height="100%"
                    defaultLanguage="wgsl" 
                    value={code} 
                    onChange={(val) => onCodeChange(val || '')}
                    theme="vs-dark"
                    options={{
                        minimap: { enabled: false },
                        fontSize: 12,
                        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                        scrollBeyondLastLine: false,
                        padding: { top: 16, bottom: 16 },
                        lineNumbers: 'on',
                        renderWhitespace: 'none',
                        smoothScrolling: true
                    }}
                />
            </div>
             {error && (
                <div className="p-4 bg-red-900/20 border-t border-red-500/30 text-red-200 text-xs font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {error.message}
                </div>
            )}
        </div>
    );
};