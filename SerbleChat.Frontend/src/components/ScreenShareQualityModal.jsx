import { useState } from 'react';
import { Modal, Button, TextInput, Hint } from './ui/index.js';
import { FieldLabel } from './ui/index.js';

const BITRATE_MIN = 500_000;
const BITRATE_MAX = 20_000_000;
const FPS_MIN = 1;
const FPS_MAX = 60;

const PRESETS = [
  // High FPS preset: 60fps, lower bitrate
  { label: 'High FPS (60fps)', fps: 60, bitrate: 5_000_000 },
  // Picture quality preset: lower fps, high bitrate
  { label: 'Picture Quality (15fps)', fps: 15, bitrate: 12_000_000 },
];

function clampInt(value, min, max) {
  const n = parseInt(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}

export default function ScreenShareQualityModal({ isOpen, ...props }) {
  // Mounting the form only while open means it starts from the current
  // settings every time, so cancelled edits don't linger into the next open.
  if (!isOpen) return null;
  return <QualityForm {...props} />;
}

function QualityForm({ onClose, currentSettings, onApply }) {
  // Kept as the raw input text so typing isn't fought by clamping on every
  // keystroke; values are clamped on blur and when applied.
  const [bitrate, setBitrate] = useState(String(currentSettings.bitrate));
  const [fps, setFps] = useState(String(currentSettings.fps));

  const bitrateValue = clampInt(bitrate, BITRATE_MIN, BITRATE_MAX);
  const fpsValue = clampInt(fps, FPS_MIN, FPS_MAX);

  const handleApply = () => {
    onApply({ bitrate: bitrateValue, fps: fpsValue });
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Screen Share Quality Settings" width={450} style={{ maxHeight: '80vh' }}>
      <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {/* Presets */}
        <div style={{ marginBottom: '1.5rem' }}>
          <FieldLabel>Presets</FieldLabel>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {PRESETS.map(p => (
              <Button
                key={p.label}
                variant="secondary"
                style={{ flex: 1, whiteSpace: 'normal' }}
                onClick={() => { setFps(String(p.fps)); setBitrate(String(p.bitrate)); }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Bitrate */}
        <div style={{ marginBottom: '1rem' }}>
          <FieldLabel htmlFor="ss-bitrate">
            Bitrate: {(bitrateValue / 1_000_000).toFixed(1)} Mbps
          </FieldLabel>
          <TextInput
            id="ss-bitrate"
            type="number"
            value={bitrate}
            onChange={e => setBitrate(e.target.value)}
            onBlur={() => setBitrate(String(bitrateValue))}
            min={BITRATE_MIN}
            max={BITRATE_MAX}
            step={500_000}
          />
          <Hint style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Range: 0.5 - 20 Mbps (500,000 - 20,000,000 bps)
          </Hint>
        </div>

        {/* FPS */}
        <div style={{ marginBottom: '1.5rem' }}>
          <FieldLabel htmlFor="ss-fps">Frame Rate: {fpsValue} fps</FieldLabel>
          <TextInput
            id="ss-fps"
            type="number"
            value={fps}
            onChange={e => setFps(e.target.value)}
            onBlur={() => setFps(String(fpsValue))}
            min={FPS_MIN}
            max={FPS_MAX}
            step={1}
          />
          <Hint style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Range: 1 - 60 fps. Resolution automatically matches your shared content.
          </Hint>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleApply}>Apply</Button>
        </div>
      </div>
    </Modal>
  );
}
