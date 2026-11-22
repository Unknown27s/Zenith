import { Cpu, RotateCcw } from 'lucide-react';
import type { Capability, DetectorOptions } from './types';

export function detectorPreset(capability: Capability): DetectorOptions {
  return { confidence: capability === 'traffic' ? 0.25 : 0.35, image_size: capability === 'traffic' ? 960 : 640,
    iou_threshold: capability === 'traffic' ? 0.6 : 0.7, analysis_fps: capability === 'traffic' ? 10 : 8,
    vehicle_classes: ['car', 'motorcycle', 'bus', 'truck'] };
}

export default function DetectorSettings({capability, options, onChange}: {capability: Capability; options: DetectorOptions; onChange: (options: DetectorOptions) => void}) {
  return <section className="panel detector-panel">
    <div className="panel-heading"><div><h2><Cpu size={21}/> Input-specific analysis settings</h2><p>{capability === 'machine_activity' ? 'Equipment activity uses motion thresholds, not YOLO electrical-state detection.' : 'YOLOv8 Nano + ByteTrack, with different editable settings for people and traffic.'}</p></div><button className="button secondary" onClick={() => onChange(detectorPreset(capability))}><RotateCcw size={15}/> Reset preset</button></div>
    {capability !== 'machine_activity' ? <>
      <div className="detector-fields"><label>Detection confidence<input type="number" min="0.1" max="0.9" step="0.05" value={options.confidence} onChange={e => onChange({...options, confidence: Number(e.target.value)})}/></label><label>Inference image size<select value={options.image_size} onChange={e => onChange({...options, image_size: Number(e.target.value) as DetectorOptions['image_size']})}>{[416,640,960,1280].map(size => <option key={size} value={size}>{size} pixels</option>)}</select></label><label>Box overlap / NMS IoU<input type="number" min="0.1" max="0.9" step="0.05" value={options.iou_threshold} onChange={e => onChange({...options, iou_threshold: Number(e.target.value)})}/></label><label>Requested analysis rate<input type="number" min="4" max="15" step="1" value={options.analysis_fps} onChange={e => onChange({...options, analysis_fps: Number(e.target.value)})}/></label></div>
      {capability === 'zone' ? <p className="detector-help">Object class: person only. The zone uses the tracked foot point and your dwell time—not the confidence score alone.</p> : <fieldset className="detector-classes"><legend>Vehicle classes to count (at least one)</legend>{(['car','motorcycle','bus','truck'] as const).map(name => <label className="checkbox" key={name}><input type="checkbox" checked={options.vehicle_classes.includes(name)} onChange={e => onChange({...options, vehicle_classes: e.target.checked ? [...options.vehicle_classes, name] : options.vehicle_classes.filter(item => item !== name)})}/>{name}</label>)}</fieldset>}
      <p className="detector-help">These are starting presets, not calibrated accuracy claims. Larger inputs cost more compute; actual sampled FPS is bounded by source FPS. Changing any setting requires confirmation again.</p>
    </> : <p className="detector-help">Use the rule panel’s region, motion-fraction threshold and sustained duration. Use operator/PLC/meter data for ON/OFF state and carbon inputs. A generic person/vehicle YOLO checkpoint is not an industrial-state classifier.</p>}
  </section>;
}
