import { useState, useEffect, useCallback } from 'react';
import { useClientOptions } from '../../context/ClientOptionsContext.jsx';
import { Slider, Select, Button, Card, SectionTitle, OptionCard, Hint } from '../ui/index.js';
import { MicIcon, SpeakerIcon, BrainIcon, RefreshIcon, VideoIcon } from '../../icons.jsx';
import { TabBody } from './common.jsx';
import { STREAM_AUDIO_DEVICE_LABEL } from '../../streamAudio.js';

const PROCESSING_OPTIONS = [
  {
    key: 'rnnoise',
    label: 'AI Noise Suppression (RNNoise)',
    icon: BrainIcon,
    description: 'Uses a neural network to filter out background noise (recommended).',
  },
];

async function enumerateMediaDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return { inputs: [], outputs: [], cameras: [] };
  // Device labels are only exposed once microphone permission has been granted,
  // so briefly open (and immediately close) a stream first.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
  } catch (err) {
    console.warn('Microphone permission unavailable; device labels may be hidden:', err);
  }
  let devices = await navigator.mediaDevices.enumerateDevices();
  // Same for camera labels, but only open the camera if they're actually hidden
  // (so the camera light doesn't flash every time settings are opened)
  if (devices.some(d => d.kind === 'videoinput' && !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(t => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (err) {
      console.warn('Camera permission unavailable; camera labels may be hidden:', err);
    }
  }
  return {
    // 'default' is already offered as its own option
    // (and our own stream audio device, which only carries what's being streamed)
    inputs: devices.filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.label !== STREAM_AUDIO_DEVICE_LABEL),
    outputs: devices.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default'),
    cameras: devices.filter(d => d.kind === 'videoinput' && d.deviceId),
  };
}

function CardHeading({ icon: Icon, children, aside }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
      <Icon size={15} />
      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{children}</span>
      {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
    </div>
  );
}

function DeviceSelect({ icon, title, devices, loading, value, onChange, fallbackName, hint }) {
  return (
    <Card>
      <CardHeading icon={icon}>{title}</CardHeading>
      <Select value={value || 'default'} onChange={e => onChange(e.target.value)} disabled={loading}>
        <option value="default">System default</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${fallbackName} ${i + 1}`}
          </option>
        ))}
      </Select>
      <Hint style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>{loading ? 'Loading devices…' : hint}</Hint>
    </Card>
  );
}

export default function VoiceAudioTab() {
  const { voiceAudioOptions, setVoiceAudioOption, localDeviceSettings, setLocalDeviceSetting } = useClientOptions();
  const [devices, setDevices] = useState({ inputs: [], outputs: [], cameras: [] });
  const [loading, setLoading] = useState(true);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await enumerateMediaDevices());
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const micVolume = voiceAudioOptions.micVolume ?? 100;

  return (
    <TabBody>
      <SectionTitle
        action={
          <Button variant="secondary" size="sm" onClick={loadDevices} disabled={loading} style={{ textTransform: 'none', letterSpacing: 'normal' }}>
            <RefreshIcon size={12} /> Refresh
          </Button>
        }
      >
        Devices
      </SectionTitle>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <DeviceSelect
          icon={MicIcon}
          title="Input Device"
          devices={devices.inputs}
          loading={loading}
          value={localDeviceSettings.inputDeviceId}
          onChange={id => setLocalDeviceSetting({ inputDeviceId: id })}
          fallbackName="Microphone"
          hint={<>Select your microphone for voice input. <strong>Note:</strong> you'll need to reconnect to voice for input changes to take effect.</>}
        />
        <DeviceSelect
          icon={SpeakerIcon}
          title="Output Device"
          devices={devices.outputs}
          loading={loading}
          value={localDeviceSettings.outputDeviceId}
          onChange={id => setLocalDeviceSetting({ outputDeviceId: id })}
          fallbackName="Speaker"
          hint="Select your speakers or headphones for audio output. Changes take effect immediately."
        />
        <DeviceSelect
          icon={VideoIcon}
          title="Camera"
          devices={devices.cameras}
          loading={loading}
          value={localDeviceSettings.cameraDeviceId}
          onChange={id => setLocalDeviceSetting({ cameraDeviceId: id })}
          fallbackName="Camera"
          hint="Select the camera to use for video calls. Changes apply the next time you turn your camera on."
        />
      </div>

      <SectionTitle>Microphone Volume</SectionTitle>
      <Card>
        <CardHeading
          icon={MicIcon}
          aside={<span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{micVolume}%</span>}
        >
          Input Volume
        </CardHeading>
        <Slider
          min={0}
          max={200}
          step={5}
          value={micVolume}
          onChange={v => setVoiceAudioOption('micVolume', v)}
          scale={['0%', '100%', '200%']}
        />
        <Hint style={{ marginTop: '0.75rem' }}>
          100% is normal volume; values above 100% boost your microphone.
        </Hint>
      </Card>

      <SectionTitle>Audio Processing</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {PROCESSING_OPTIONS.map(opt => (
          <OptionCard
            key={opt.key}
            indicator="toggle"
            selected={!!voiceAudioOptions[opt.key]}
            onSelect={() => setVoiceAudioOption(opt.key, !voiceAudioOptions[opt.key])}
            icon={opt.icon}
            label={opt.label}
            description={opt.description}
          />
        ))}
      </div>

      <SectionTitle>Voice Input Mode</SectionTitle>
      <Card>
        <CardHeading icon={MicIcon}>Input Detection Mode</CardHeading>
        <Select
          value={voiceAudioOptions.inputMode || 'voice-activity'}
          onChange={e => setVoiceAudioOption('inputMode', e.target.value)}
        >
          <option value="voice-activity">Voice Activity Detection</option>
          <option value="push-to-talk">Push to Talk</option>
        </Select>
        <Hint style={{ marginTop: '0.75rem' }}>
          <strong>Voice Activity:</strong> your microphone transmits automatically when you speak.
          <br />
          <strong>Push to Talk:</strong> hold a key to transmit, release to stop. Useful in noisy environments.
        </Hint>
      </Card>
    </TabBody>
  );
}
