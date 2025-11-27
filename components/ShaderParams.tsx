
import React from 'react';
import { ShaderParam, UniformLayout } from '../types';

// --- Logic ---
export const calculateUniformLayout = (params: ShaderParam[], startOffset: number = 0): UniformLayout => {
  let currentOffset = startOffset;
  const offsetMap: Record<string, number> = {};

  params.forEach(param => {
    let alignment = 4;
    let size = 4;

    if (param.type === 'color' || param.type === 'vec3') {
      alignment = 16;
      size = 16;
    }

    const padding = (alignment - (currentOffset % alignment)) % alignment;
    currentOffset += padding;
    offsetMap[param.id] = currentOffset;
    currentOffset += size;
  });

  const totalPadding = (16 - (currentOffset % 16)) % 16;
  const totalSize = currentOffset + totalPadding;

  return { size: totalSize, offsetMap };
};

export const writeParamsToBuffer = (
  data: Float32Array, 
  params: ShaderParam[], 
  layout: UniformLayout
) => {
  params.forEach(param => {
    const floatOffset = layout.offsetMap[param.id] / 4;
    if (param.type === 'float') {
      data[floatOffset] = param.value;
    } else if (param.type === 'color' || param.type === 'vec3') {
      data[floatOffset] = param.value[0];
      data[floatOffset + 1] = param.value[1];
      data[floatOffset + 2] = param.value[2];
    }
  });
};

// --- UI Component ---
interface ShaderControlsProps {
  params: ShaderParam[];
  setParams: (newParams: ShaderParam[]) => void;
}

export const ShaderControls: React.FC<ShaderControlsProps> = ({ params, setParams }) => {

  const handleFloatChange = (id: string, newVal: number) => {
    const nextParams = params.map(p => {
      if (p.id === id && p.type === 'float') {
        return { ...p, value: newVal };
      }
      return p;
    });
    setParams(nextParams);
  };

  const handleColorChange = (id: string, hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const newColor: [number, number, number] = [r, g, b];

    const nextParams = params.map(p => {
      if (p.id === id && (p.type === 'color' || p.type === 'vec3')) {
        return { ...p, value: newColor };
      }
      return p;
    });
    setParams(nextParams);
  };

  const rgbToHex = (rgb: [number, number, number]) => {
    const toHex = (c: number) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
        {params.map(param => (
        <div key={param.id} className="group shrink-0">
            <div className="flex justify-between items-baseline mb-2">
                <label className="text-[10px] font-mono uppercase tracking-widest text-gray-400 group-hover:text-acid transition-colors select-none">
                    {param.label}
                </label>
                <span className="text-[10px] font-mono text-white">
                    {param.type === 'float' ? param.value.toFixed(2) : ''}
                </span>
            </div>

            {param.type === 'float' && (
                <div className="relative h-4 flex items-center">
                    <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step={param.step || 0.01}
                        value={param.value}
                        onChange={(e) => handleFloatChange(param.id, parseFloat(e.target.value))}
                        className="w-full z-10 opacity-0 absolute inset-0 cursor-pointer"
                    />
                    <div className="w-full h-[1px] bg-white/20 relative">
                        <div 
                            className="absolute top-0 bottom-0 bg-white transition-all duration-75"
                            style={{ width: `${((param.value - param.min) / (param.max - param.min)) * 100}%` }}
                        />
                    </div>
                    <div 
                        className="absolute w-2 h-2 bg-acid rotate-45 pointer-events-none transition-all duration-75 shadow-[0_0_5px_rgba(204,255,0,0.5)]"
                        style={{ left: `${((param.value - param.min) / (param.max - param.min)) * 100}%`, transform: 'translateX(-50%) rotate(45deg)' }}
                    />
                </div>
            )}

            {(param.type === 'color' || param.type === 'vec3') && (
                <div className="flex gap-2">
                    <div className="relative w-full h-8 border border-white/20 group-hover:border-white transition-colors cursor-pointer bg-white/5">
                        <input
                            type="color"
                            value={rgbToHex(param.value)}
                            onChange={(e) => handleColorChange(param.id, e.target.value)}
                            className="opacity-0 absolute inset-0 w-full h-full cursor-pointer z-10"
                        />
                        <div className="absolute inset-1" style={{ backgroundColor: rgbToHex(param.value) }}></div>
                    </div>
                    <div className="font-mono text-[9px] self-center text-white/30 tracking-widest">{rgbToHex(param.value)}</div>
                </div>
            )}
        </div>
        ))}
    </div>
  );
};
