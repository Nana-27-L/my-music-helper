# SingMyKey Lean Roadmap

## Product Direction

SingMyKey is not trying to become a full professional DAW or all-in-one music workstation.

It is a focused singing helper for people who:

- like singing
- find that many songs are not in the right key for them
- do not know how much to shift a song
- want a simple path from testing their range to singing over a fitting accompaniment

The core promise is:

1. measure the user's vocal range accurately enough to be trustworthy
2. generate a high-quality accompaniment in a better key
3. let the user sing over it and export a finished song

## Core Features

### 1. Accurate vocal range testing

Primary goal:

- produce a believable comfortable range, not just a flashy real-time pitch demo

Current foundation:

- [frontend/src/components/VocalRangeTester.jsx](D:/应用开发/我的音乐助手/frontend/src/components/VocalRangeTester.jsx)
- [frontend/src/lib/pitch.js](D:/应用开发/我的音乐助手/frontend/src/lib/pitch.js)
- [backend/app/services/profiles.py](D:/应用开发/我的音乐助手/backend/app/services/profiles.py)

What matters:

- stable long-note detection
- low/high capture without noisy false positives
- repeatable results across multiple tries
- simple guidance so users know to sing, not speak

### 2. High-quality transposed accompaniment

Primary goal:

- output a version that is easier to sing and still sounds clean

Current foundation:

- [backend/app/services/separation.py](D:/应用开发/我的音乐助手/backend/app/services/separation.py)
- [backend/app/services/song_processing.py](D:/应用开发/我的音乐助手/backend/app/services/song_processing.py)
- [backend/app/services/audio.py](D:/应用开发/我的音乐助手/backend/app/services/audio.py)
- [backend/app/api/routes/audio.py](D:/应用开发/我的音乐助手/backend/app/api/routes/audio.py)

What matters:

- accompaniment-only output when separation is available
- clear recommendation reason
- fewer audible artifacts in the shifted result
- reliable support for the common files users actually upload

### 3. Sing along and export a finished song

Primary goal:

- after the accompaniment is generated, let the user record vocals directly and export a combined track

Current foundation:

- [frontend/src/components/SongProcessor.jsx](D:/应用开发/我的音乐助手/frontend/src/components/SongProcessor.jsx)
- [frontend/src/lib/api.js](D:/应用开发/我的音乐助手/frontend/src/lib/api.js)
- [backend/app/services/audio.py](D:/应用开发/我的音乐助手/backend/app/services/audio.py)
- [backend/app/api/routes/audio.py](D:/应用开发/我的音乐助手/backend/app/api/routes/audio.py)

What matters:

- simple record flow
- headset-first guidance to avoid bleed
- clean vocal plus accompaniment mix
- one-click export of the final song

## Build Order

## Phase 1

Focus: make the current promise work end to end.

1. Tighten vocal range accuracy
2. Improve the explanation for why a shift is recommended
3. Keep accompaniment generation reliable
4. Add sing-along recording and mix export

## Phase 2

Focus: improve quality without making the product complicated.

1. Better pitch-shift quality for final export
2. Better accompaniment-vocal mix defaults
3. More upload format support such as `wav` and `m4a`
4. Better retry and progress states for long processing

## Phase 3

Focus: polish the happy path instead of expanding into a giant feature set.

1. Save multiple takes for the same song
2. Add quick A/B compare between original and shifted accompaniment
3. Add simple vocal gain / accompaniment gain controls
4. Add lightweight history for past vocal profiles and exports

## Explicit Non-Goals For Now

These are intentionally not priorities:

- complex song scoring systems
- full section-by-section musicological analysis
- multi-profile singer modeling
- deep professional mixing controls
- DAW-style editing timeline

## Success Criteria

The product is succeeding if a user can:

1. open the app and understand how to test their range
2. upload a song and get a believable key recommendation
3. hear a transposed accompaniment that still sounds good
4. record themselves over it and export a finished file

## Best Next Step

After the current implementation lands, the best next improvement is:

- make vocal range testing more repeatable and confidence-aware in
  [frontend/src/components/VocalRangeTester.jsx](D:/应用开发/我的音乐助手/frontend/src/components/VocalRangeTester.jsx)
  and
  [frontend/src/lib/pitch.js](D:/应用开发/我的音乐助手/frontend/src/lib/pitch.js)

That is still the highest-leverage investment, because every later accompaniment decision depends on trusting the singer profile.
