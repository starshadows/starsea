#!/usr/bin/env python3
"""星落成诗 / When Starlight Finds the Water — original score, September 2026.

64 bars in E-flat major, 6/8, expressive dotted-quarter tempo around 52 BPM.
Recorded grand piano, viola/cello ensembles and harp; no pre-existing song.
Requires Python 3, numpy, scipy, ffmpeg. All rendering is offline; the website
only plays the resulting MP3. Sample credits: dist/audio/CREDITS.txt.
Run: python tools/compose_soundtrack.py
"""
from functools import lru_cache
from fractions import Fraction
from pathlib import Path
import hashlib
import json
import math
import subprocess
import urllib.request
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'music/generated'
SR = 44100
TITLE = '星落成诗'
STEM = 'starlight-on-water'
RNG = np.random.default_rng(9182026)
SAMPLES = json.loads((ROOT / 'music/samples.json').read_text())


def midi(note):
    accidental = 1 if '#' in note else -1 if 'b' in note else 0
    return 12 * (int(note[-1]) + 1) + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[note[0]] + accidental


# Bass, five left-hand pitches, and close inner voices for the string section.
CHORDS = {
    'Eb': ('Eb2', ['Bb2', 'Eb3', 'G3', 'Bb3', 'F4'], ['G3', 'Bb3', 'D4']),
    'BbD': ('D2', ['Bb2', 'F3', 'Bb3', 'D4', 'F4'], ['F3', 'Bb3', 'D4']),
    'Cm': ('C2', ['G2', 'C3', 'Eb3', 'G3', 'D4'], ['G3', 'Bb3', 'Eb4']),
    'Ab': ('Ab2', ['Eb3', 'Ab3', 'C4', 'Eb4', 'G4'], ['Ab3', 'C4', 'Eb4']),
    'Fm': ('F2', ['C3', 'F3', 'Ab3', 'C4', 'Eb4'], ['Ab3', 'C4', 'Eb4']),
    'EbG': ('G2', ['Bb2', 'Eb3', 'G3', 'Bb3', 'D4'], ['G3', 'Bb3', 'Eb4']),
    'Bb': ('Bb1', ['F3', 'Bb3', 'D4', 'F4', 'C5'], ['F3', 'Bb3', 'D4']),
    'Bbs': ('Bb1', ['F3', 'Bb3', 'Eb4', 'F4', 'C5'], ['F3', 'Bb3', 'Eb4']),
    'Gm': ('G2', ['D3', 'G3', 'Bb3', 'D4', 'F4'], ['G3', 'Bb3', 'D4']),
    'G7': ('G2', ['D3', 'G3', 'B3', 'D4', 'F4'], ['G3', 'B3', 'F4']),
    'Abm': ('Ab2', ['Eb3', 'Ab3', 'B3', 'Eb4', 'Gb4'], ['Ab3', 'B3', 'Eb4']),
    'Eb6': ('Eb2', ['Bb2', 'Eb3', 'G3', 'Bb3', 'C4'], ['G3', 'Bb3', 'C4']),
}
A_CHORDS = ['Eb', 'BbD', 'Cm', 'Ab', 'Fm', 'EbG', 'Ab', 'Bb'] * 2
BRIDGE_CHORDS = ['Cm', 'Gm', 'Ab', 'EbG', 'Fm', 'Abm', 'Bbs', 'Bb']
B_CHORDS = ['Ab', 'EbG', 'Fm', 'Bb', 'Gm', 'Cm', 'Fm', 'Bb',
            'Ab', 'Bb', 'Cm', 'Gm', 'Fm', 'EbG', 'Ab', 'Bb']
PROGRESSION = ['Eb', 'BbD', 'Cm', 'Ab'] + A_CHORDS + BRIDGE_CHORDS + B_CHORDS + A_CHORDS + ['Fm', 'Bb', 'Eb6', 'Eb6']

# Each tuple is (eighth-note offset, pitch, length in eighth notes).
# The central motif G–Bb–Eb rises, then D–C–Bb answers it in the next bar.
THEME = [
    [(0, 'G4', 1), (1, 'Bb4', 2), (3, 'Eb5', 2.7)],
    [(0, 'D5', 3), (3, 'C5', 1), (4, 'Bb4', 1.8)],
    [(0, 'G4', 1), (1, 'C5', 2), (3, 'Eb5', 2), (5, 'D5', .8)],
    [(0, 'C5', 3), (3, 'Bb4', 1), (4, 'Ab4', 1.6)],
    [(0, 'Ab4', 1), (1, 'C5', 1), (2, 'F5', 2), (4, 'Eb5', 1.7)],
    [(0, 'D5', 1), (1, 'Eb5', 2), (3, 'Bb4', 2.5)],
    [(0, 'C5', 2), (2, 'Bb4', 1), (3, 'G4', 1), (4, 'Ab4', 1.7)],
    [(0, 'F4', 3.5), (4.5, 'G4', .5), (5, 'Ab4', .75)],
    [(0, 'G4', 1), (1, 'Bb4', 2), (3, 'Eb5', 2), (5, 'F5', .8)],
    [(0, 'D5', 2), (2, 'C5', 1), (3, 'Bb4', 2.7)],
    [(0, 'G4', 1), (1, 'C5', 2), (3, 'Eb5', 1), (4, 'G5', 1.7)],
    [(0, 'F5', 2), (2, 'Eb5', 1), (3, 'C5', 2.4)],
    [(0, 'Ab4', 1), (1, 'C5', 2), (3, 'Eb5', 1), (4, 'F5', 1.7)],
    [(0, 'Eb5', 2), (2, 'D5', 1), (3, 'Bb4', 2.4)],
    [(0, 'C5', 2), (2, 'Bb4', 1), (3, 'Ab4', 1), (4, 'G4', 1.6)],
    [(0, 'F4', 4.4)],
]
BRIDGE = [
    [(1, 'Eb5', 4)], [(0, 'D5', 3), (4, 'Bb4', 1.7)],
    [(1, 'C5', 4)], [(0, 'Bb4', 3.2)],
    [(0, 'Ab4', 2), (3, 'C5', 2.5)],
    [(0, 'B4', 3), (3, 'Ab4', 2)],
    [(0, 'Bb4', 3), (3, 'C5', 2.5)],
    [(0, 'D5', 3), (4, 'Eb5', 1), (5, 'F5', .8)],
]
CHORUS = [
    [(0, 'Eb5', 1), (1, 'G5', 2), (3, 'Ab5', 2.7)],
    [(0, 'G5', 3), (3, 'F5', 1), (4, 'Eb5', 1.8)],
    [(0, 'F5', 2), (2, 'Eb5', 1), (3, 'C5', 2.8)],
    [(0, 'D5', 3), (3, 'F5', 2.6)],
    [(0, 'G5', 3), (3, 'F5', 1), (4, 'D5', 1.8)],
    [(0, 'Eb5', 2), (2, 'G5', 1), (3, 'C6', 2.7)],
    [(0, 'Bb5', 2), (2, 'Ab5', 1), (3, 'G5', 1), (4, 'F5', 1.7)],
    [(0, 'F5', 4.6)],
    [(0, 'Eb5', 1), (1, 'G5', 2), (3, 'Ab5', 2), (5, 'Bb5', .8)],
    [(0, 'F5', 3), (3, 'D5', 2.7)],
    [(0, 'Eb5', 1), (1, 'G5', 2), (3, 'C6', 2), (5, 'Bb5', .8)],
    [(0, 'A5', 1), (1, 'G5', 2), (3, 'F5', 1), (4, 'D5', 1.7)],
    [(0, 'C5', 1), (1, 'Eb5', 2), (3, 'F5', 2.7)],
    [(0, 'Eb5', 2), (2, 'D5', 1), (3, 'Bb4', 2.6)],
    [(0, 'C5', 2), (2, 'Bb4', 1), (3, 'Ab4', 1), (4, 'G4', 1.7)],
    [(0, 'F4', 4.4), (5, 'D4', .7)],
]
INTRO = [[(3, 'Bb4', 2)], [], [(3, 'G4', 2)], [(3, 'Ab4', 2)]]
CODA = [[(0, 'Ab4', 2), (3, 'C5', 2.5)], [(0, 'Bb4', 2), (3, 'F4', 2.5)],
        [(0, 'G4', 2), (2, 'F4', 1), (3, 'Eb4', 2.8)], [(0, 'Eb4', 10)]]
RETURN = [list(bar) for bar in THEME]
RETURN[15] = [(0, 'F4', 3), (3, 'G4', 2.4)]
MELODY = INTRO + THEME + BRIDGE + CHORUS + RETURN + CODA
assert len(PROGRESSION) == len(MELODY) == 64

# Phrase-level rubato, shared by every instrument. No independent metronomes.
TEMPI = []
for bar in range(64):
    bpm = 48 if bar < 4 else 52 if bar < 20 else 49 if bar < 28 else 54 if bar < 44 else 51 if bar < 60 else [48, 46, 43, 41][bar - 60]
    if bar in [11, 19, 27, 35, 43, 51, 59]:
        bpm *= .955
    TEMPI.append(bpm)
BAR_LENGTHS = [120 / t for t in TEMPI]
STARTS = np.concatenate([[.14], .14 + np.cumsum(BAR_LENGTHS)])
DURATION = float(STARTS[-1] + 7.2)
N = math.ceil(DURATION * SR)


def sample_path(item):
    path = OUT / 'samples' / item['file']
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print('Downloading', item['file'], flush=True)
        request = urllib.request.Request(item['url'], headers={'User-Agent': 'Starsea-offline-composer/2'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        verify_sample(item, data)
        path.write_bytes(data)
    return path


def verify_sample(item, data):
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if actual != item['git_blob_sha1']:
        raise ValueError('Sample checksum mismatch: ' + item['file'])


@lru_cache(maxsize=96)
def load_sample(index):
    item = SAMPLES[index]
    path = sample_path(item)
    verify_sample(item, path.read_bytes())
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-t', '13',
                          '-ar', str(SR), '-ac', '2', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).copy()
    # Trim only leading near-silence, keeping the recorded attack intact.
    envelope = np.max(np.abs(x), axis=1)
    active = np.flatnonzero(envelope > max(float(envelope.max()) * .015, .000015))
    if len(active):
        x = x[max(0, int(active[0]) - int(.004 * SR)):]
    x = signal.sosfilt(signal.butter(2, 36, 'highpass', fs=SR, output='sos'), x, axis=0).astype(np.float32)
    if item['instrument'] in ('viola', 'cello'):
        rms = np.sqrt(np.mean(x[int(.25 * SR):int(2.0 * SR)] ** 2))
        x *= .09 / max(rms, .001)
    elif item['instrument'] == 'harp':
        x *= .22 / max(float(np.max(np.abs(x))), .01)
    else:
        # Modest correction of uneven recorded key levels; preserve the dynamics.
        peak = np.percentile(np.abs(x[:int(.8 * SR)]), 99.7)
        target = .19 if item['layer'] == 4 else .26
        x *= np.clip(target / max(peak, .01), .6, 2.8)
    return x


@lru_cache(maxsize=160)
def pitched(instrument, pitch, layer):
    choices = [(i, s) for i, s in enumerate(SAMPLES)
               if s['instrument'] == instrument and s['layer'] == layer]
    index, item = min(choices, key=lambda pair: abs(pair[1]['midi'] - pitch))
    rate = 2 ** ((pitch - item['midi'] + item['tune_cents'] / 100) / 12)
    ratio = Fraction(1 / rate).limit_denominator(800)
    x = signal.resample_poly(load_sample(index), ratio.numerator, ratio.denominator, axis=0)
    cutoff = 7400 if instrument == 'piano' else 4100 if instrument in ('viola', 'cello') else 9000
    return signal.sosfilt(signal.butter(2, cutoff, fs=SR, output='sos'), x, axis=0).astype(np.float32)


EVENTS = []


def place(bus, instrument, note, when, hold, velocity, gain, pan=0):
    pitch = midi(note) if isinstance(note, str) else note
    layer = (8 if velocity >= .67 else 4) if instrument == 'piano' else 1
    x = pitched(instrument, pitch, layer)
    bowed = instrument in ('viola', 'cello')
    release = 1.0 if bowed else 1.35 if instrument == 'piano' else 2.6
    size = min(len(x), round((hold + release) * SR))
    t = np.arange(size, dtype=np.float32) / SR
    env = np.ones(size, np.float32)
    if bowed:
        env *= np.sin(np.minimum(t / .65, 1) * np.pi / 2) ** 2
        env *= .86 + .14 * np.sin(np.minimum(t / max(hold, .1), 1) * np.pi)
        env *= np.cos(np.clip((t - hold) / release, 0, 1) * np.pi / 2) ** 2
    else:
        env *= np.minimum(t / .003, 1)
        env *= np.exp(-np.maximum(t - hold, 0) * (5.5 / release))
        env *= np.clip((hold + release - t) / .045, 0, 1)
    start = max(0, round(when * SR))
    size = min(size, len(bus) - start)
    if size <= 0:
        return
    # Retain the recording's stereo image; make placement subtle, not hard-panned.
    balance = np.array([1 - max(pan, 0) * .42, 1 + min(pan, 0) * .42], np.float32)
    bus[start:start + size] += x[:size] * env[:size, None] * balance * gain * velocity ** 1.2
    EVENTS.append({'instrument': instrument, 'midi': pitch, 'start': round(when, 5),
                   'hold': round(hold, 5), 'velocity': round(velocity, 4)})


def room(bus, rt60, wet, seed):
    rng = np.random.default_rng(seed)
    t = np.arange(round((rt60 + .3) * SR), dtype=np.float32) / SR
    result = np.zeros_like(bus)
    for side in range(2):
        ir = rng.standard_normal(len(t)).astype(np.float32)
        ir = signal.sosfilt(signal.butter(2, [190, 4100], 'bandpass', fs=SR, output='sos'), ir).astype(np.float32)
        ir *= np.exp(-6.908 * t / rt60) * np.clip((t - .035) / .04, 0, 1)
        ir /= max(np.sqrt(np.sum(ir * ir)), 1e-8)
        source = bus[:, side] * .75 + bus[:, 1 - side] * .25
        result[:, side] = signal.fftconvolve(source, ir)[:N] * wet
        for delay, amount in [(.029, .12), (.057, .08), (.089, .055)]:
            d = round((delay + side * .006) * SR)
            result[d:, side] += bus[:-d, 1 - side] * amount * wet
    return result


def render():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f'Rendering {TITLE}: 64 bars, {DURATION:.2f} seconds', flush=True)
    piano = np.zeros((N, 2), np.float32)
    strings = np.zeros_like(piano)
    harp = np.zeros_like(piano)
    sections = [(0, 'Prelude'), (4, 'Theme'), (20, 'Still water'), (28, 'Starlight'), (44, 'Return'), (60, 'Coda')]
    for bar, chord in enumerate(PROGRESSION):
        start = STARTS[bar]
        length = BAR_LENGTHS[bar]
        eighth = length / 6
        bass, arp, voices = CHORDS[chord]
        energy = .73 if bar < 4 else .86 if bar < 20 else .71 if bar < 28 else 1.04 if bar < 44 else .84 if bar < 60 else .63
        energy *= 1 + .025 * math.sin(bar * .83)
        # Half-pedal clears the bass at the next harmony; accompaniment breathes.
        place(piano, 'piano', bass, start, length * .88, .60, .63 * energy, -.16)
        pattern = [(1, 0), (2, 1), (3, 2), (4, 1), (5, 0)]
        if bar % 8 == 3:
            pattern = [(1, 0), (2, 1), (3, 2), (4, 3)]
        if 20 <= bar < 28:
            pattern = [(1, 0), (2, 1), (4, 2)]
        if bar in [11, 19, 27, 43, 59]:
            pattern = [(1, 0), (2, 1), (3, 2)]
        if bar >= 62:
            pattern = [(.17, 0), (.35, 1), (.54, 2), (.76, 3)] if bar == 63 else [(1, 0), (2, 1), (3, 2)]
        for beat, j in pattern:
            hold = max(.42, length - beat * eighth + .12)
            if bar == 63:
                hold = 5.8
            place(piano, 'piano', arp[j], start + beat * eighth + RNG.uniform(-.012, .012),
                  hold, .52 + RNG.uniform(-.035, .035), .40 * energy, -.11 + .055 * j)
        for j, (beat, note, duration) in enumerate(MELODY[bar]):
            vel = (.72 if 28 <= bar < 44 else .65) + RNG.uniform(-.025, .025)
            if j == 0:
                vel += .025
            if bar < 4 or bar >= 60:
                vel -= .10
            place(piano, 'piano', note, start + beat * eighth + .018 + RNG.uniform(-.01, .015),
                  duration * eighth + .16, vel, 1.17 * energy, .075)
        # Strings join after the theme has spoken; they withdraw for the ending.
        if 12 <= bar < 62:
            level = .067 if bar < 20 else .042 if bar < 28 else .10 if bar < 44 else .05
            for j, note in enumerate(voices):
                place(strings, 'viola', note, start + j * .035, length - .02, .64,
                      level * energy, [-.32, .12, .35][j])
            if 28 <= bar < 44:
                place(strings, 'cello', midi(bass) + 12, start + .04, length, .63, .074, -.22)
        # Single, quiet harp responses at phrase endings; no continuous glitter.
        if bar in [2, 6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62]:
            note = midi(arp[2]) + 12
            place(harp, 'harp', note, start + 4.0 * eighth, 2.9, .62, .20 * energy, .33)
            if bar in [18, 30, 38, 54]:
                place(harp, 'harp', midi(arp[3]) + 12, start + 5 * eighth, 2.7, .55, .16 * energy, -.29)
        if (bar + 1) % 8 == 0:
            print(f'  Rendered {bar + 1}/64 bars', flush=True)
    print('Mixing acoustic space and mastering', flush=True)
    mix = piano + strings + harp
    mix += room(piano, 2.7, .19, 11)
    mix += room(strings, 3.5, .24, 19)
    mix += room(harp, 3.8, .23, 31)
    mix = signal.sosfilt(signal.butter(2, 38, 'highpass', fs=SR, output='sos'), mix, axis=0).astype(np.float32)
    fadein, fadeout = round(.6 * SR), round(3.8 * SR)
    mix[:fadein] *= np.sin(np.linspace(0, np.pi / 2, fadein, dtype=np.float32))[:, None] ** 2
    mix[-fadeout:] *= np.cos(np.linspace(0, np.pi / 2, fadeout, dtype=np.float32))[:, None] ** 2
    mix *= .70 / np.max(np.abs(mix))
    raw = OUT / (STEM + '-premaster.wav')
    wavfile.write(raw, SR, mix)
    measure = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(raw), '-af',
        'loudnorm=I=-19:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    metrics = json.loads(measure.stderr[measure.stderr.rfind('{'):])
    normalizer = ('loudnorm=I=-19:TP=-2:LRA=11:linear=true:'
        f"measured_I={metrics['input_i']}:measured_TP={metrics['input_tp']}:"
        f"measured_LRA={metrics['input_lra']}:measured_thresh={metrics['input_thresh']}:"
        f"offset={metrics['target_offset']}")
    master = OUT / (STEM + '-master.wav')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(raw), '-af', normalizer,
                    '-ar', str(SR), '-c:a', 'pcm_s24le', str(master)], check=True)
    mp3 = OUT / (STEM + '.mp3')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(master), '-c:a', 'libmp3lame',
                    '-b:a', '160k', '-ar', str(SR), '-metadata', 'title=' + TITLE,
                    '-metadata', 'artist=Starsea Original Soundtrack',
                    '-metadata', 'album=星海之间', '-metadata',
                    'comment=Original score. Piano: Salamander Grand Piano by Alexander Holm, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/); sampled, retuned, sequenced and mixed. Strings and harp: VSCO 2 CE, CC0. Full credits: audio/CREDITS.txt',
                    str(mp3)], check=True)
    result = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(mp3), '-af',
        'loudnorm=I=-19:TP=-2:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    loudness = json.loads(result.stderr[result.stderr.rfind('{'):])
    sections_out = [{'name': name, 'bar': bar + 1, 'seconds': round(float(STARTS[bar]), 2)} for bar, name in sections]
    report = {'title': TITLE, 'duration_seconds': round(DURATION, 3), 'meter': '6/8',
              'key': 'E-flat major', 'bars': 64, 'tempo_unit': 'dotted quarter',
              'nominal_tempo_bpm': 52, 'mp3_bytes': mp3.stat().st_size, 'bitrate_kbps': 160,
              'mp3_integrated_lufs': float(loudness['input_i']),
              'mp3_true_peak_dbtp': float(loudness['input_tp']),
              'mp3_loudness_range_lu': float(loudness['input_lra']), 'sections': sections_out,
              'note_events': len(EVENTS), 'sample_sources': ['Salamander Grand Piano', 'VSCO 2 Community Edition']}
    (OUT / 'audio-checks.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    (OUT / 'score-events.json').write_text(json.dumps(EVENTS, indent=2) + '\n')
    # Short local previews do not become additional website payloads.
    for name, offset in [('theme', STARTS[4]), ('starlight', STARTS[28])]:
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(offset), '-i', str(master),
                        '-t', '22', '-af', 'afade=t=in:d=0.2,afade=t=out:st=20:d=2',
                        '-c:a', 'libmp3lame', '-b:a', '160k', str(OUT / (STEM + '-' + name + '.mp3'))], check=True)
    raw.unlink()
    print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    render()
