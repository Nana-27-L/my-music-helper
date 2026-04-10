const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const A4_FREQUENCY = 440;
const A4_MIDI = 69;
const MIN_SIGNAL_RMS = 0.015;
const MIN_VOCAL_FREQUENCY = 65;
const MAX_VOCAL_FREQUENCY = 1400;

function getRootMeanSquare(buffer) {
  let total = 0;

  for (let i = 0; i < buffer.length; i += 1) {
    total += buffer[i] * buffer[i];
  }

  return Math.sqrt(total / buffer.length);
}

export function analyzePitch(buffer, sampleRate) {
  const size = buffer.length;
  const maxSamples = Math.floor(size / 2);
  const rms = getRootMeanSquare(buffer);

  if (rms < MIN_SIGNAL_RMS) {
    return {
      clarity: 0,
      frequency: null,
      reason: "too-quiet",
      rms,
    };
  }

  const minOffset = Math.max(2, Math.floor(sampleRate / MAX_VOCAL_FREQUENCY));
  const maxOffset = Math.min(maxSamples, Math.floor(sampleRate / MIN_VOCAL_FREQUENCY));
  const correlations = new Array(maxOffset + 1).fill(0);

  let bestOffset = -1;
  let bestCorrelation = 0;
  let foundGoodCorrelation = false;
  let lastCorrelation = 1;

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    let correlation = 0;

    for (let i = 0; i < maxSamples; i += 1) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }

    correlation = 1 - correlation / maxSamples;
    correlations[offset] = correlation;

    if (correlation > 0.9 && correlation > lastCorrelation) {
      foundGoodCorrelation = true;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    } else if (foundGoodCorrelation) {
      const previous = correlations[bestOffset - 1] ?? correlations[bestOffset];
      const next = correlations[bestOffset + 1] ?? correlations[bestOffset];
      const shift = (next - previous) / correlations[bestOffset];
      const frequency = sampleRate / (bestOffset + 8 * shift);

      if (frequency >= MIN_VOCAL_FREQUENCY && frequency <= MAX_VOCAL_FREQUENCY) {
        return {
          clarity: bestCorrelation,
          frequency,
          reason: "pitched",
          rms,
        };
      }

      return {
        clarity: bestCorrelation,
        frequency: null,
        reason: "out-of-range",
        rms,
      };
    }

    lastCorrelation = correlation;
  }

  if (bestCorrelation > 0.92 && bestOffset !== -1) {
    const frequency = sampleRate / bestOffset;

    if (frequency >= MIN_VOCAL_FREQUENCY && frequency <= MAX_VOCAL_FREQUENCY) {
      return {
        clarity: bestCorrelation,
        frequency,
        reason: "pitched",
        rms,
      };
    }
  }

  return {
    clarity: bestCorrelation,
    frequency: null,
    reason: "unstable",
    rms,
  };
}

export function detectPitch(buffer, sampleRate) {
  return analyzePitch(buffer, sampleRate).frequency;
}

export function frequencyToNote(frequency) {
  if (!frequency || frequency <= 0) {
    return null;
  }

  const exactMidi = 12 * Math.log2(frequency / A4_FREQUENCY) + A4_MIDI;
  const midi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - midi) * 100);
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  return {
    cents,
    frequency,
    midi,
    noteName: `${NOTE_NAMES[noteIndex]}${octave}`,
  };
}
