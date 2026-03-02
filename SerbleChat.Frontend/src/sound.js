/**
 * Sound utility module for playing UI sounds
 */

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Map of sound names to their file paths
const SOUND_FILES = {
  notification: '/sounds/notification.ogg',
  mute: '/sounds/mute.ogg',
  unmute: '/sounds/unmute.ogg',
  deafen: '/sounds/deafen.ogg',
  undeafen: '/sounds/undeafen.ogg',
  join: '/sounds/join.ogg',
  leave: '/sounds/leave.ogg',
  stream_start: '/sounds/stream_start.ogg',
  stream_end: '/sounds/stream_end.ogg',
};

// Cache for decoded audio buffers
const audioBufferCache = {};

/**
 * Load and cache an audio file
 * @param {string} soundName - The name of the sound (key in SOUND_FILES)
 * @returns {Promise<AudioBuffer>}
 */
async function loadAudioBuffer(soundName) {
  if (audioBufferCache[soundName]) {
    return audioBufferCache[soundName];
  }

  const filePath = SOUND_FILES[soundName];
  if (!filePath) {
    throw new Error(`Sound "${soundName}" not found`);
  }

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filePath}: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioBufferCache[soundName] = audioBuffer;
    return audioBuffer;
  } catch (error) {
    console.error(`Failed to load sound "${soundName}":`, error);
    throw error;
  }
}

/**
 * Play a sound
 * @param {string} soundName - The name of the sound to play
 * @param {number} [volume=1] - The volume level (0-1)
 * @returns {Promise<void>}
 */
export async function playSound(soundName, volume = 1) {
  try {
    // Resume audio context if suspended (required by some browsers)
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const audioBuffer = await loadAudioBuffer(soundName);
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();

    source.buffer = audioBuffer;
    gainNode.gain.value = Math.max(0, Math.min(1, volume)); // Clamp volume between 0 and 1

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    source.start(0);
  } catch (error) {
    console.error(`Failed to play sound "${soundName}":`, error);
  }
}

/**
 * Preload multiple sounds for faster playback
 * @param {string[]} soundNames - Array of sound names to preload
 * @returns {Promise<void>}
 */
export async function preloadSounds(soundNames) {
  try {
    await Promise.all(soundNames.map(name => loadAudioBuffer(name)));
  } catch (error) {
    console.error('Failed to preload sounds:', error);
  }
}

/**
 * Check if a sound exists
 * @param {string} soundName - The name of the sound to check
 * @returns {boolean}
 */
export function soundExists(soundName) {
  return soundName in SOUND_FILES;
}

/**
 * Get the path for a sound file
 * @param {string} soundName - The name of the sound
 * @returns {string|null}
 */
export function getSoundPath(soundName) {
  return SOUND_FILES[soundName] ?? null;
}
