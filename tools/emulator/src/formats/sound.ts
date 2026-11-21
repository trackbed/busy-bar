// Sounds for the page to play. The bar plays a sound file as raw PCM (16-bit
// little-endian, mono, 44.1 kHz) from its first byte, without reading any
// header (audio_play_file in the firmware); the firmware repository keeps
// its stock sounds as WAV sources.

import { ascii } from './bytes.ts';

/** A sound ready for the page, and how long it plays. */
export interface Sound {
  readonly wav: Uint8Array;
  readonly durationMs: number;
}

/** The rate the bar plays raw sound files at. */
export const PCM_RATE = 44_100;
const PCM_BYTES_PER_SAMPLE = 2;

/**
 * An uploaded sound file, played as the bar plays it: every byte is a
 * sample, so a WAV header plays as a short click, like on the device.
 */
export function rawPcmSound(pcm: Uint8Array): Sound {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  header.set(ascii('RIFF'), 0);
  view.setUint32(4, 36 + pcm.length, true);
  header.set(ascii('WAVE'), 8);
  header.set(ascii('fmt '), 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, PCM_RATE, true);
  view.setUint32(28, PCM_RATE * PCM_BYTES_PER_SAMPLE, true);
  view.setUint16(32, PCM_BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  header.set(ascii('data'), 36);
  view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(header);
  wav.set(pcm, 44);
  return {
    wav,
    durationMs: (pcm.length / (PCM_RATE * PCM_BYTES_PER_SAMPLE)) * 1000,
  };
}

/** A stock sound's WAV source, passed through with its playing time. */
export function wavSound(wav: Uint8Array): Sound {
  return { wav, durationMs: wavDuration(wav) };
}

/** The playing time of a WAV, from its byte rate and data size; 0 if unreadable. */
function wavDuration(data: Uint8Array): number {
  const tag = (offset: number): string =>
    String.fromCharCode(...data.subarray(offset, offset + 4));
  if (data.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    return 0;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 20 <= data.length) {
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === 'data') {
      return byteRate > 0
        ? (Math.min(size, data.length - offset - 8) / byteRate) * 1000
        : 0;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}
