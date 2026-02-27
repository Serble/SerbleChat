import { useState, useEffect } from 'react';

export default function ScreenShareQualityModal({ isOpen, onClose, currentSettings, onApply }) {
  const [bitrate, setBitrate] = useState(currentSettings.bitrate);
  const [fps, setFps] = useState(currentSettings.fps);

  useEffect(() => {
    setBitrate(currentSettings.bitrate);
    setFps(currentSettings.fps);
  }, [currentSettings]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply({ bitrate, fps });
    onClose();
  };

  const applyPreset = (preset) => {
    if (preset === 'highFps') {
      // High FPS preset: 60fps, lower bitrate
      setFps(60);
      setBitrate(5_000_000);
    } else if (preset === 'pictureQuality') {
      // Picture quality preset: lower fps, high bitrate
      setFps(15);
      setBitrate(12_000_000);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          padding: '1.5rem',
          maxWidth: '450px',
          width: '90%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', color: 'var(--text-primary)' }}>
          Screen Share Quality Settings
        </h2>

        {/* Presets */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Presets
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => applyPreset('highFps')}
              style={{
                flex: 1,
                padding: '0.5rem',
                background: 'rgba(59,130,246,0.15)',
                border: '1px solid rgba(59,130,246,0.35)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.15)'}
            >
              High FPS (60fps)
            </button>
            <button
              onClick={() => applyPreset('pictureQuality')}
              style={{
                flex: 1,
                padding: '0.5rem',
                background: 'rgba(168,85,247,0.15)',
                border: '1px solid rgba(168,85,247,0.35)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(168,85,247,0.25)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(168,85,247,0.15)'}
            >
              Picture Quality (15fps)
            </button>
          </div>
        </div>

        {/* Bitrate */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Bitrate: {(bitrate / 1_000_000).toFixed(1)} Mbps
          </label>
          <input
            type="number"
            value={bitrate}
            onChange={(e) => setBitrate(Math.max(500_000, Math.min(20_000_000, parseInt(e.target.value) || 0)))}
            min={500_000}
            max={20_000_000}
            step={500_000}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Range: 0.5 - 20 Mbps (500,000 - 20,000,000 bps)
          </div>
        </div>

        {/* FPS */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            Frame Rate: {fps} fps
          </label>
          <input
            type="number"
            value={fps}
            onChange={(e) => setFps(Math.max(1, Math.min(60, parseInt(e.target.value) || 0)))}
            min={1}
            max={60}
            step={1}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Range: 1 - 60 fps. Resolution automatically matches your shared content.
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            style={{
              padding: '0.5rem 1rem',
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.35)',
              borderRadius: '6px',
              color: 'var(--success)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(34,197,94,0.25)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(34,197,94,0.15)'}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
