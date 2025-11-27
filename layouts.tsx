
import React, { useEffect, useState } from 'react';
import { LayoutMode } from './types';

interface LayoutOverlayProps {
    mode: LayoutMode;
    scrollRef: React.RefObject<HTMLDivElement | null>;
}

export const LayoutOverlay: React.FC<LayoutOverlayProps> = ({ mode, scrollRef }) => {
    const [scrollProgress, setScrollProgress] = useState(0);

    // Track scroll progress for bar
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || mode !== 'scroll') return;
        const handleScroll = () => {
            const total = el.scrollHeight - el.clientHeight;
            setScrollProgress(el.scrollTop / total);
        };
        el.addEventListener('scroll', handleScroll);
        return () => el.removeEventListener('scroll', handleScroll);
    }, [mode, scrollRef]);

    if (mode === 'clean') return <div ref={scrollRef} className="absolute inset-0 overflow-hidden pointer-events-none" />;

    // Force pointer events for scroll mode so user can drag
    const containerPointerEvents = mode === 'scroll' ? 'pointer-events-auto' : 'pointer-events-none';

    return (
        <div 
            ref={scrollRef} 
            className={`absolute inset-0 overflow-y-auto custom-scrollbar z-30 ${containerPointerEvents}`}
        >
            {/* Scroll Progress Bar */}
            {mode === 'scroll' && (
                <div className="fixed top-10 left-0 h-1 bg-acid z-50 transition-all duration-75" style={{ width: `${scrollProgress * 100}%` }}></div>
            )}

            {/* --- CENTER HERO --- */}
            {mode === 'center' && (
                <div className="min-h-full flex flex-col items-center justify-center p-6 text-center relative">
                    <div className="space-y-6 max-w-[90vw] animate-fade-in-up pointer-events-auto mix-blend-difference text-white">
                        <div className="flex justify-center mb-8">
                            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md">
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-acid opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-acid"></span>
                                </span>
                                <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/90">Experience v2.4</span>
                            </div>
                        </div>
                        <h1 className="text-[12vw] font-bold tracking-tighter leading-[0.8] mix-blend-overlay opacity-90 select-none">
                            KINETIC<br /><span className="text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40 font-light italic tracking-tight">ENERGY</span>
                        </h1>
                        <div className="h-px w-32 bg-gradient-to-r from-transparent via-white/50 to-transparent mx-auto my-8"></div>
                        <p className="text-sm md:text-base font-mono text-gray-300 max-w-xl mx-auto leading-relaxed uppercase tracking-widest opacity-80">
                            Real-time WebGPU Simulation <br/> <span className="text-acid">0ms Latency</span> // Native Resolution
                        </p>
                        <div className="flex flex-col md:flex-row gap-4 justify-center pt-12">
                            <button className="group relative px-8 py-4 bg-white text-black font-mono text-xs uppercase font-bold tracking-widest overflow-hidden transition-transform hover:scale-105">
                                <div className="absolute inset-0 bg-acid translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                                <span className="relative group-hover:text-black transition-colors z-10">Launch Project</span>
                            </button>
                            <button className="px-8 py-4 border border-white/30 text-white font-mono text-xs uppercase font-bold tracking-widest hover:bg-white hover:text-black transition-colors backdrop-blur-sm">Documentation</button>
                        </div>
                    </div>
                     <div className="h-screen"></div> {/* Dummy spacer for scrolling */}
                </div>
            )}

            {/* --- SPLIT --- */}
            {mode === 'split' && (
                <div className="min-h-full flex flex-col md:flex-row pointer-events-none">
                    <div className="w-full md:w-[45%] p-12 md:p-24 flex flex-col justify-between bg-black/20 backdrop-blur-xl border-r border-white/5 pointer-events-auto">
                        <div className="text-[10px] font-mono text-acid mb-12 flex items-center gap-2">
                             <div className="w-1 h-1 bg-acid"></div>SECTION 01 / INTRO
                        </div>
                        <div className="space-y-12 animate-fade-in-up">
                            <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-white leading-[0.9]">RAW<br/><span className="font-light italic text-gray-400">MATH.</span></h1>
                            <div className="space-y-6 max-w-sm">
                                <p className="text-gray-400 text-sm leading-relaxed font-light border-l border-white/20 pl-6">We replace predefined assets with mathematical functions. Every pixel is calculated 60 times per second.</p>
                                <div className="flex gap-4 text-[10px] font-mono uppercase text-gray-500">
                                    <span className="px-2 py-1 border border-white/10 rounded">SDF Geometry</span>
                                    <span className="px-2 py-1 border border-white/10 rounded">Raymarching</span>
                                </div>
                            </div>
                        </div>
                        <div className="pt-24 flex items-center justify-between border-t border-white/10">
                            <div className="flex flex-col"><span className="text-3xl font-bold text-white">4.2<span className="text-sm text-gray-500 ml-1">GB</span></span><span className="text-[10px] font-mono text-gray-500 uppercase">Assets Saved</span></div>
                             <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center hover:bg-white hover:text-black transition-all cursor-pointer"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg></div>
                        </div>
                    </div>
                     <div className="h-screen w-full"></div> {/* Dummy spacer */}
                </div>
            )}

            {/* --- CARDS --- */}
            {mode === 'cards' && (
                <div className="min-h-full p-6 md:p-24 flex items-center justify-center pointer-events-none flex-col">
                    <div className="grid grid-cols-1 md:grid-cols-4 grid-rows-auto md:grid-rows-2 gap-4 w-full max-w-[1400px] h-full pointer-events-auto">
                        <div className="md:col-span-2 md:row-span-2 p-10 rounded-[2rem] bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-2xl border border-white/10 shadow-2xl flex flex-col justify-between group hover:border-white/20 transition-all duration-500">
                            <div className="flex justify-between items-start"><div className="text-4xl md:text-6xl font-bold tracking-tighter text-white">NEXT<br/>LEVEL</div><div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-acid group-hover:text-black transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div></div>
                            <div className="space-y-4"><p className="text-gray-400 text-sm leading-relaxed max-w-md">Modular shader architecture.</p><div className="h-1 w-full bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-acid w-2/3 shadow-[0_0_15px_#ccff00]"></div></div></div>
                        </div>
                        <div className="md:col-span-1 p-8 rounded-[2rem] bg-black/60 backdrop-blur-xl border border-white/10 flex flex-col justify-center items-center text-center hover:bg-black/80 transition-colors">
                            <span className="text-[10px] font-mono uppercase text-gray-500 tracking-widest mb-2">Performance</span>
                            <span className="text-5xl font-bold text-white tracking-tighter">60<span className="text-lg text-acid">FPS</span></span>
                        </div>
                        <div className="md:col-span-1 p-8 rounded-[2rem] bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 transition-colors flex flex-col justify-between">
                             <div className="flex -space-x-2">{[1,2,3].map(i => (<div key={i} className="w-8 h-8 rounded-full border border-black bg-gray-800 flex items-center justify-center text-[10px] text-white">U{i}</div>))}</div>
                             <div className="text-right"><div className="text-sm font-bold text-white">Team Ready</div></div>
                        </div>
                        <div className="md:col-span-2 p-8 rounded-[2rem] bg-black/40 backdrop-blur-xl border border-white/5 flex items-center justify-between group hover:border-acid/50 transition-colors">
                             <div><div className="text-xs font-mono text-acid mb-1">UPDATED</div><div className="text-xl font-bold text-white">Texture Streaming Support</div></div>
                             <button className="px-6 py-2 rounded-full border border-white/20 text-xs font-mono uppercase hover:bg-white hover:text-black transition-colors">Read Docs</button>
                        </div>
                    </div>
                     <div className="h-[50vh]"></div>
                </div>
            )}

            {/* --- SCROLL: AWARD WINNING --- */}
            {mode === 'scroll' && (
                <div className="w-full relative">
                    <style>{`
                        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
                        .animate-marquee { animation: marquee 20s linear infinite; }
                    `}</style>
                    {/* Fixed Grain Overlay */}
                    <div className="fixed inset-0 pointer-events-none opacity-[0.05] z-40 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] mix-blend-overlay"></div>

                    {/* Section 1: Pinned Hero */}
                    <div className="h-[150vh] relative">
                         <div className="sticky top-0 h-screen flex flex-col justify-center px-6 md:px-24">
                             <div className="relative mix-blend-difference z-20">
                                 <h1 className="text-[18vw] font-bold leading-[0.8] tracking-tighter text-white select-none">
                                     DIGITAL<br/>
                                     <span className="ml-[10vw] font-serif italic font-light opacity-80">AETHER</span>
                                 </h1>
                                 <div className="flex justify-between items-end mt-8 border-t border-white/50 pt-8">
                                     <div className="font-mono text-xs md:text-sm max-w-xs leading-relaxed uppercase">
                                         Exploring the intersection of <br/> Raymarching and DOM Events.
                                     </div>
                                     <div className="hidden md:block animate-spin-slow w-24 h-24 border border-dashed border-white rounded-full flex items-center justify-center">
                                         <div className="w-2 h-2 bg-acid rounded-full"></div>
                                     </div>
                                 </div>
                             </div>
                         </div>
                    </div>

                    {/* Section 2: Marquee Band */}
                    <div className="py-24 bg-acid mix-blend-difference relative z-30 overflow-hidden transform -skew-y-2 origin-left">
                        <div className="whitespace-nowrap animate-marquee flex gap-12 text-black font-bold text-6xl md:text-9xl tracking-tighter">
                            <span>WEBGL 2.0</span><span>WEBGPU</span><span>COMPUTE SHADERS</span><span>REALTIME</span><span>RAYTRACING</span><span>WEBGL 2.0</span><span>WEBGPU</span><span>COMPUTE SHADERS</span>
                        </div>
                    </div>

                    {/* Section 3: Technical Cards (Glass) */}
                    <div className="min-h-screen py-32 px-6 md:px-24 grid grid-cols-1 md:grid-cols-2 gap-8 relative z-20">
                        <div className="md:col-span-2 mb-12">
                             <h2 className="text-6xl md:text-8xl font-bold text-white mix-blend-overlay tracking-tight">SYSTEM<br/>ARCH</h2>
                        </div>
                        
                        <div className="p-12 rounded-3xl bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 transition-all duration-500 group">
                            <div className="text-acid font-mono text-xs mb-4 uppercase tracking-widest">[01] The Shader</div>
                            <h3 className="text-3xl font-bold text-white mb-6 group-hover:translate-x-2 transition-transform">Procedural Generation</h3>
                            <p className="text-gray-400 leading-relaxed">No textures are loaded. The entire scene is defined by Signed Distance Functions (SDFs) calculated per-pixel. This ensures infinite resolution at any scale.</p>
                        </div>

                         <div className="p-12 rounded-3xl bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 transition-all duration-500 group md:mt-24">
                            <div className="text-acid font-mono text-xs mb-4 uppercase tracking-widest">[02] The DOM</div>
                            <h3 className="text-3xl font-bold text-white mb-6 group-hover:translate-x-2 transition-transform">Scroll Sync</h3>
                            <p className="text-gray-400 leading-relaxed">JavaScript listens to native scroll events and normalizes the value to a 0-1 float, passing it to the GPU buffer instantly for lag-free visual feedback.</p>
                        </div>
                    </div>

                    {/* Section 4: Big Footer */}
                    <div className="h-[80vh] flex items-center justify-center bg-black relative z-10 border-t border-white/10">
                         <div className="text-center w-full">
                             <div className="text-[15vw] font-bold text-white/5 select-none tracking-widest leading-none">END</div>
                             <div className="absolute inset-0 flex flex-col items-center justify-center">
                                 <button className="px-12 py-4 border border-white/20 rounded-full hover:bg-white hover:text-black transition-all duration-300 font-mono text-sm uppercase tracking-widest">
                                     Start New Project
                                 </button>
                             </div>
                         </div>
                    </div>
                </div>
            )}
        </div>
    );
};
