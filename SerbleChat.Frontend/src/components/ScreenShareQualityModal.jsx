import { useState, useEffect, useCallback } from 'react';
import { Modal, ModalBody, ModalFooter, Button, Slider, FieldLabel, OptionGroup, Hint, ToggleRow, List, ListRow, Toggle } from './ui/index.js';
import { ScreenShareIcon, LightningIcon, ImageIcon, GearIcon, SpeakerIcon, RefreshIcon } from '../icons.jsx';
import { getStreamAudioSupport, listStreamAudioApps, DEFAULT_STREAM_AUDIO } from '../streamAudio.js';

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

const AUDIO_SOURCE_OPTIONS = [
  { value: 'all',  label: 'All apps',    description: 'Everything playing on your computer, except Serble Chat.' },
  { value: 'apps', label: 'Chosen apps', description: 'Only the apps you pick below.' },
];

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

function QualityForm({ onClose, currentSettings, onApply, isLive = false }) {
  const [bitrate, setBitrate] = useState(clamp(Number(currentSettings.bitrate) || PRESETS.smooth.bitrate, BITRATE_MIN, BITRATE_MAX));
  const [fps, setFps]         = useState(clamp(Number(currentSettings.fps) || PRESETS.smooth.fps, FPS_MIN, FPS_MAX));
  // "Custom" stays selected while the sliders are being dragged even if they
  // pass through a preset's exact values
  const [customPicked, setCustomPicked] = useState(false);
  const preset = customPicked ? 'custom' : presetFor(bitrate, fps);

  const [audio, setAudio] = useState(currentSettings.audio ?? DEFAULT_STREAM_AUDIO.audio);
  const [audioApps, setAudioApps] = useState(currentSettings.audioApps ?? DEFAULT_STREAM_AUDIO.audioApps);
  const [audioSupport, setAudioSupport] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getStreamAudioSupport().then(s => { if (!cancelled) setAudioSupport(s); });
    return () => { cancelled = true; };
  }, []);
  const audioSource = audioApps ? 'apps' : 'all';

  function pickPreset(p) {
    if (p === 'custom') { setCustomPicked(true); return; }
    setCustomPicked(false);
    setBitrate(PRESETS[p].bitrate);
    setFps(PRESETS[p].fps);
  }

  function handleApply() {
    // Picking "Chosen apps" and then none of them means no sound
    const noAppsChosen = audioApps && audioApps.length === 0;
    onApply({ bitrate, fps, audio: audio && !noAppsChosen, audioApps: noAppsChosen ? null : audioApps });
    onClose();
  }

  const valueStyle = { fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' };

  return (
    <Modal onClose={onClose} title="Stream Settings" icon={ScreenShareIcon} width={480} onSubmit={handleApply}>
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

        <AudioSettings
          support={audioSupport}
          audio={audio}
          setAudio={setAudio}
          audioSource={audioSource}
          setAudioSource={v => setAudioApps(v === 'apps' ? (audioApps ?? []) : null)}
          audioApps={audioApps}
          setAudioApps={setAudioApps}
          isLive={isLive}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary">Apply</Button>
      </ModalFooter>
    </Modal>
  );
}

function AudioSettings({ support, audio, setAudio, audioSource, setAudioSource, audioApps, setAudioApps, isLive }) {
  const supported = !!support?.supported;
  const description = !support ? 'Checking…' : supported ? support.hint : support.reason;

  return (
    <div>
      <ToggleRow
        title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}><SpeakerIcon size={15} /> Share audio</span>}
        description={description}
        checked={supported && audio}
        onChange={setAudio}
        disabled={!supported}
        toggleTitle={supported ? (audio ? 'Stop sharing audio' : 'Share audio') : (support?.reason ?? undefined)}
      />
      {supported && audio && isLive && !support.canChangeLive && (
        <Hint style={{ marginTop: '-1rem', marginBottom: '1rem' }}>Turning audio on while you're live means picking what to share again.</Hint>
      )}
      {supported && audio && support.canPickApps && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <FieldLabel>Sound from</FieldLabel>
            <OptionGroup options={AUDIO_SOURCE_OPTIONS} value={audioSource} onChange={setAudioSource} />
          </div>
          {audioSource === 'apps' && <AppPicker chosen={audioApps ?? []} onChange={setAudioApps} />}
        </div>
      )}
    </div>
  );
}

/** The apps to share sound from: the ones playing now, plus any already chosen. */
function AppPicker({ chosen, onChange }) {
  const [playing, setPlaying] = useState(null);
  const refresh = useCallback(() => {
    setPlaying(null);
    listStreamAudioApps().then(setPlaying).catch(() => setPlaying([]));
  }, []);
  useEffect(refresh, [refresh]);

  // Chosen apps that aren't playing right now still show, so they can be unticked
  const apps = [...(playing ?? [])];
  for (const id of chosen) {
    if (!apps.some(a => a.id === id)) apps.push({ id, name: id, notPlaying: true });
  }

  function toggle(id, on) {
    onChange(on ? [...chosen, id] : chosen.filter(x => x !== id));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <FieldLabel style={{ marginBottom: 0 }}>Apps</FieldLabel>
        <Button variant="ghost" size="sm" onClick={refresh} title="Look again for apps playing sound">
          <RefreshIcon size={13} /> Refresh
        </Button>
      </div>
      {playing === null && apps.length === 0 ? (
        <Hint>Looking for apps…</Hint>
      ) : apps.length === 0 ? (
        <Hint>No apps are playing sound right now. Start playing something, then refresh.</Hint>
      ) : (
        <List style={{ maxHeight: 220, overflowY: 'auto' }}>
          {apps.map(app => (
            <ListRow
              key={app.id}
              title={app.name}
              subtitle={app.notPlaying ? 'Not playing right now' : (app.binary && app.binary !== app.name ? app.binary : null)}
              actions={<Toggle checked={chosen.includes(app.id)} onChange={on => toggle(app.id, on)} title={`Share ${app.name}'s sound`} />}
            />
          ))}
        </List>
      )}
      {chosen.length === 0 && apps.length > 0 && <Hint style={{ marginTop: '0.4rem' }}>Pick at least one app, or no sound will be shared.</Hint>}
    </div>
  );
}
