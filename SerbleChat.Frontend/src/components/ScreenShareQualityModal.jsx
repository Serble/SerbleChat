import { useState } from 'react';
import { Modal, ModalBody, ModalFooter, Button, Slider, FieldLabel, OptionGroup, Hint } from './ui/index.js';
import { ScreenShareIcon, LightningIcon, ImageIcon, GearIcon } from '../icons.jsx';

const BITRATE_MIN = 500_000;
const BITRATE_MAX = 20_000_000;
const BITRATE_STEP = 500_000;
const FPS_MIN = 1;
const FPS_MAX = 60;

const PRESETS = {
  // Smooth motion: 60fps, lower bitrate
  smooth: { fps: 60, bitrate: 5_000_000 },
  // Sharp picture: lower fps, high bitrate
  sharp:  { fps: 15, bitrate: 12_000_000 },
};

const PRESET_OPTIONS = [
  { value: 'smooth', icon: LightningIcon, label: 'Smooth motion', badge: '60 fps', description: 'Best for games and video. Fine detail may soften.' },
  { value: 'sharp',  icon: ImageIcon,     label: 'Sharp picture', badge: '15 fps', description: 'Best for code, documents and slides.' },
  { value: 'custom', icon: GearIcon,      label: 'Custom',        description: 'Pick your own bitrate and frame rate below.' },
];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function presetFor(bitrate, fps) {
  return Object.keys(PRESETS).find(k => PRESETS[k].bitrate === bitrate && PRESETS[k].fps === fps) ?? 'custom';
}

export default function ScreenShareQualityModal({ isOpen, ...props }) {
  // Mounting the form only while open means it starts from the current
  // settings every time, so cancelled edits don't linger into the next open.
  if (!isOpen) return null;
  return <QualityForm {...props} />;
}

function QualityForm({ onClose, currentSettings, onApply }) {
  const [bitrate, setBitrate] = useState(clamp(Number(currentSettings.bitrate) || PRESETS.smooth.bitrate, BITRATE_MIN, BITRATE_MAX));
  const [fps, setFps]         = useState(clamp(Number(currentSettings.fps) || PRESETS.smooth.fps, FPS_MIN, FPS_MAX));
  // "Custom" stays selected while the sliders are being dragged even if they
  // pass through a preset's exact values
  const [customPicked, setCustomPicked] = useState(false);
  const preset = customPicked ? 'custom' : presetFor(bitrate, fps);

  function pickPreset(p) {
    if (p === 'custom') { setCustomPicked(true); return; }
    setCustomPicked(false);
    setBitrate(PRESETS[p].bitrate);
    setFps(PRESETS[p].fps);
  }

  function handleApply() {
    onApply({ bitrate, fps });
    onClose();
  }

  const valueStyle = { fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' };

  return (
    <Modal onClose={onClose} title="Screen Share Quality" icon={ScreenShareIcon} width={480} onSubmit={handleApply}>
      <ModalBody>
        <div>
          <FieldLabel>Preset</FieldLabel>
          <OptionGroup options={PRESET_OPTIONS} value={preset} onChange={pickPreset} />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <FieldLabel htmlFor="ss-bitrate">Bitrate</FieldLabel>
            <span style={valueStyle}>{(bitrate / 1_000_000).toFixed(1)} Mbps</span>
          </div>
          <Slider
            id="ss-bitrate"
            min={BITRATE_MIN} max={BITRATE_MAX} step={BITRATE_STEP}
            value={bitrate}
            onChange={v => { setCustomPicked(true); setBitrate(v); }}
            scale={['0.5 Mbps', '20 Mbps']}
          />
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <FieldLabel htmlFor="ss-fps">Frame Rate</FieldLabel>
            <span style={valueStyle}>{fps} fps</span>
          </div>
          <Slider
            id="ss-fps"
            min={FPS_MIN} max={FPS_MAX} step={1}
            value={fps}
            onChange={v => { setCustomPicked(true); setFps(v); }}
            scale={['1 fps', '60 fps']}
          />
        </div>

        <Hint>Resolution automatically matches what you're sharing. Higher bitrates look better but need a faster connection.</Hint>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">Apply</Button>
      </ModalFooter>
    </Modal>
  );
}
