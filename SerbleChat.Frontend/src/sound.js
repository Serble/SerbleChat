/**
 * Sound utility module for playing UI sounds
 */

import { getAssetPath } from './electron-utils.js';

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Map of sound names to their file paths
const SOUND_FILES = {
  notification: getAssetPath('/sounds/notification.ogg'),
  mute: getAssetPath('/sounds/mute.ogg'),
  unmute: getAssetPath('/sounds/unmute.ogg'),
  deafen: getAssetPath('/sounds/deafen.ogg'),
  undeafen: getAssetPath('/sounds/undeafen.ogg'),
  join: getAssetPath('/sounds/join.ogg'),
  leave: getAssetPath('/sounds/leave.ogg'),
  stream_start: getAssetPath('/sounds/stream_start.ogg'),
  stream_end: getAssetPath('/sounds/stream_end.ogg'),
};

// Cache for decoded audio buffers
const audioBufferCache = {};

// Track if user has interacted with the page (required for audio autoplay)
let userHasInteracted = false;

// Set up user interaction tracking
if (typeof window !== 'undefined') {
  const markInteraction = () => {
    if (!userHasInteracted) {
      userHasInteracted = true;
      console.log('[Sound] User interaction detected - audio enabled');
    }
  };
  
  window.addEventListener('click', markInteraction, { once: false });
  window.addEventListener('keydown', markInteraction, { once: false });
  window.addEventListener('touchstart', markInteraction, { once: false });
}

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
    console.log(`[Sound] Loading sound "${soundName}" from path: ${filePath}`);
    console.log(`[Sound] Window location: ${window.location.href}`);
    console.log(`[Sound] Protocol: ${window.location.protocol}`);
    
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${filePath}: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    audioBufferCache[soundName] = audioBuffer;
    console.log(`[Sound] Successfully loaded sound "${soundName}"`);
    return audioBuffer;
  } catch (error) {
    console.error(`[Sound] Failed to load sound "${soundName}" from ${filePath}:`, error);
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
      console.log(`[Sound] Audio context suspended, attempting to resume for "${soundName}"`);
      try {
        await audioContext.resume();
        console.log(`[Sound] Audio context resumed successfully`);
      } catch (err) {
        console.error(`[Sound] Failed to resume audio context:`, err);
        // Don't throw, try to play anyway
      }
    }

    const audioBuffer = await loadAudioBuffer(soundName);
    const source = audioContext.createBufferSource();
    const gainNode = audioContext.createGain();

    source.buffer = audioBuffer;
    gainNode.gain.value = Math.max(0, Math.min(1, volume)); // Clamp volume between 0 and 1

    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    source.start(0);
    console.log(`[Sound] Playing sound "${soundName}" (volume: ${gainNode.gain.value.toFixed(2)})`);
  } catch (error) {
    console.error(`[Sound] Failed to play sound "${soundName}":`, error);
    throw error; // Re-throw so caller knows it failed
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

/**
 * Get the current audio context state
 * @returns {string} - 'running', 'suspended', or 'closed'
 */
export function getAudioContextState() {
  return audioContext.state;
}

/**
 * Resume the audio context (useful to call after user interaction)
 * @returns {Promise<void>}
 */
export async function resumeAudioContext() {
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
}

/**
 * SoundManager - A simplified interface for managing sounds
 */
export class SoundManager {
  /**
   * Play a sound by name
   * @param {string} soundName - The name of the sound to play
   * @param {number} [volume=1] - The volume level (0-1)
   */
  static async play(soundName, volume = 1) {
    return playSound(soundName, volume);
  }
  
  /**
   * Preload sounds for faster playback
   * @param {string[]} soundNames - Array of sound names to preload
   */
  static async preload(soundNames) {
    return preloadSounds(soundNames);
  }
  
  /**
   * Check if audio is ready to play
   * @returns {boolean}
   */
  static isReady() {
    return audioContext.state !== 'suspended';
  }
  
  /**
   * Ensure audio context is ready
   */
  static async ensureReady() {
    return resumeAudioContext();
  }
}
