#!/usr/bin/env python3
"""星海未眠 / Starsea, Still Awake — an original miniature by Codex.

Reproducible, sample-free instrumental: 32 bars, D major, 4/4, 68 BPM.
Requires Python 3, numpy, scipy, and ffmpeg. Outputs are saved in music/generated/.
Run: python tools/compose_soundtrack.py
"""
from pathlib import Path
import json
import math
import subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile

HERE = Path(__file__).resolve().parents[1] / "music" / "generated"
HERE.mkdir(parents=True, exist_ok=True)
SR = 44100
BPM = 68
BEAT = 60.0 / BPM
BAR = 4 * BEAT
LEAD = 0.35
DURATION = LEAD + 32 * BAR + 4.2
N = math.ceil(DURATION * SR)
RNG = np.random.default_rng(20260918)


def midi(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
             "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    return 12 * (int(name[-1]) + 1) + names[name[:-1]]


def hz(name):
    return 440.0 * 2 ** ((midi(name) - 69) / 12)


def insert(bus, sound, when, gain=1., pan=0.):
    start = round(when * SR)
    if start < 0:
        sound = sound[-start:]
        start = 0
    size = min(len(sound), len(bus) - start)
    if size <= 0:
        return
    if sound.ndim == 1:
        angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        bus[start:start + size, 0] += sound[:size] * (gain * np.cos(angle))
        bus[start:start + size, 1] += sound[:size] * (gain * np.sin(angle))
    else:
        bus[start:start + size] += sound[:size] * gain


def felt_piano(name, hold, velocity=.7):
    """Damped stiff-string modes, paired strings, felt hammer and key noise."""
    f = hz(name)
    length = max(3.2, hold + 2.25)
    t = np.arange(round(length * SR), dtype=np.float64) / SR
    result = np.zeros_like(t)
    stiff = .000035 * (f / 220.) ** .45
    detune = .00048
    # Higher modes decay sooner; the fundamental and second mode bloom gently.
    for mode in range(1, 11):
        weight = np.array([1., .42, .215, .128, .070, .047, .030, .020, .013, .009])[mode - 1]
        decay = (2.65 * (220. / f) ** .20) / mode ** .55
        env = (1. - np.exp(-t / (.005 + .001 * mode))) * np.exp(-t / decay)
        env *= np.exp(-np.maximum(t - hold, 0.) / (.55 + .35 / mode))
        fm = f * mode * np.sqrt(1 + stiff * mode * mode)
        phase = RNG.uniform(-.045, .045)
        tone = .62 * np.cos(2 * np.pi * fm * t + phase)
        tone += .38 * np.cos(2 * np.pi * fm * (1 + detune) * t - phase)
        result += weight * env * tone
    noise = RNG.standard_normal(len(t))
    noise = signal.sosfilt(signal.butter(2, [350, 4200], btype="bandpass", fs=SR, output="sos"), noise)
    result += noise * .10 * np.exp(-t / .017) * (1 - np.exp(-t / .0015))
    # Gentle soundboard resonance below the main string modes.
    result += .025 * np.sin(2 * np.pi * f * .5 * t) * np.exp(-t / .24) * (1 - np.exp(-t / .008))
    result *= velocity ** 1.35
    result *= np.minimum(1., np.maximum(0., (length - t) / .08))
    return result.astype(np.float32)


def pad(name, duration, phase):
    """Soft, breathy, slowly detuned string-like pad; no percussion or subbass."""
    release = 2.6
    t = np.arange(round((duration + release) * SR), dtype=np.float64) / SR
    f = hz(name)
    out = np.zeros((len(t), 2), np.float64)
    for side in (0, 1):
        for partial, amp in [(1, 1.), (2, .26), (3, .115), (4, .045), (5, .017)]:
            drift = .012 * np.sin(2 * np.pi * (.072 + partial * .007) * t + phase + side)
            voice = np.sin(2 * np.pi * f * partial * (1 + (side * 2 - 1) * .00085) * t + phase + drift)
            voice += .37 * np.sin(2 * np.pi * f * partial * (1 + (side * 2 - 1) * .0018) * t - phase)
            out[:, side] += amp * voice
    envelope = np.sin(np.minimum(t / 1.6, 1) * np.pi / 2) ** 2
    envelope *= np.where(t <= duration, 1., np.cos(np.minimum((t - duration) / release, 1) * np.pi / 2) ** 2)
    envelope *= .95 + .05 * np.sin(2 * np.pi * .12 * t + phase)
    out *= envelope[:, None]
    return out.astype(np.float32)


def star(name):
    f = hz(name)
    t = np.arange(round(5.2 * SR), dtype=np.float64) / SR
    out = np.zeros_like(t)
    # Sparse glass/celesta modes, with the strongest modes in consonant octaves.
    for ratio, amp, decay in [(1, 1., 1.7), (2, .32, .85), (3, .065, .44), (4.008, .055, .36)]:
        out += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / decay)
    out *= (1 - np.exp(-t / .012))
    out *= np.minimum(1, (5.2 - t) / .1)
    return out.astype(np.float32)


def reverb(bus, decay, wet, seed, predelay=.045):
    """Stereo late diffusion plus non-rhythmic early room reflections."""
    rng = np.random.default_rng(seed)
    seconds = decay * 1.7
    t = np.arange(round(seconds * SR)) / SR
    result = np.zeros_like(bus)
    mono = (bus[:, 0] + bus[:, 1]) * .7071
    for side in (0, 1):
        ir = rng.standard_normal(len(t))
        ir = signal.sosfilt(signal.butter(2, 3500, fs=SR, output="sos"), ir)
        ir = signal.sosfilt(signal.butter(1, 170, btype="highpass", fs=SR, output="sos"), ir)
        onset = np.minimum(np.maximum((t - predelay) / .12, 0), 1)
        ir *= np.exp(-t * 3.5 / decay) * onset
        ir /= max(np.sqrt(np.sum(ir * ir)), 1e-8)
        late = signal.fftconvolve(mono, ir, mode="full")[:N]
        result[:, side] = late * wet
        for time, amp in [(.067, .17), (.109, .115), (.173, .085), (.227, .055)]:
            delay = round((time + side * .013) * SR)
            result[delay:, side] += bus[:-delay, 1 - side] * amp
    return result


# Every bar is intentionally voiced and every melody note is composed here.
# Chord entries: bass, four pad voices, four arpeggio notes.
CHORDS = {
    "D": ("D3", ["F#3", "A3", "C#4", "E4"], ["A3", "D4", "F#4", "A4"]),
    "Ac": ("C#3", ["E3", "A3", "B3", "E4"], ["A3", "C#4", "E4", "B4"]),
    "Bm": ("B2", ["F#3", "A3", "C#4", "D4"], ["F#3", "B3", "D4", "F#4"]),
    "G": ("G2", ["F#3", "A3", "B3", "D4"], ["G3", "B3", "D4", "A4"]),
    "Em": ("E3", ["G3", "B3", "D4", "F#4"], ["G3", "B3", "D4", "F#4"]),
    "Df": ("F#3", ["A3", "D4", "E4", "F#4"], ["A3", "D4", "F#4", "A4"]),
    "As": ("A2", ["G3", "B3", "D4", "E4"], ["A3", "D4", "E4", "G4"]),
    "A": ("A2", ["G3", "A3", "C#4", "E4"], ["A3", "C#4", "E4", "G4"]),
    "Fm": ("F#3", ["A3", "C#4", "E4", "G#4"], ["A3", "C#4", "E4", "A4"]),
    "Da": ("A2", ["F#3", "A3", "D4", "E4"], ["A3", "D4", "E4", "F#4"]),
    "D6": ("D3", ["F#3", "A3", "B3", "E4"], ["A3", "D4", "F#4", "B4"]),
}
PROGRESSION = [
    "D", "Ac", "Bm", "G", "Em", "Df", "G", "A",
    "D", "Ac", "Bm", "G", "Em", "Df", "G", "As",
    "Bm", "Fm", "G", "Da", "Em", "Bm", "G", "A",
    "D", "Ac", "Bm", "G", "Em", "Df", "As", "D6",
]

# (beat offset, pitch, written length in beats)
MELODY = [
    [(0, "F#4", 1), (1, "A4", .5), (1.5, "B4", .5), (2, "A4", 1), (3, "F#4", .75)],
    [(0, "E4", 1.5), (1.5, "F#4", .5), (2, "A4", 1), (3, "E4", .75)],
    [(.25, "F#4", .75), (1, "B4", 1), (2, "D5", 1), (3, "C#5", .5), (3.5, "B4", .5)],
    [(0, "A4", 1.5), (1.5, "F#4", .5), (2, "G4", 1.75)],
    [(0, "G4", 1), (1, "B4", .5), (1.5, "A4", .5), (2, "F#4", 1), (3, "E4", .75)],
    [(0, "F#4", 1.5), (1.5, "A4", .5), (2, "D5", 1.75)],
    [(.5, "B4", 1), (1.5, "A4", .5), (2, "G4", 1), (3, "F#4", .75)],
    [(0, "E4", 1.5), (1.5, "F#4", .5), (2, "E4", 1.75)],
    [(0, "F#4", 1), (1, "A4", .5), (1.5, "B4", .5), (2, "A4", 1), (3, "D5", .75)],
    [(0, "C#5", 1.5), (1.5, "B4", .5), (2, "A4", 1), (3, "E4", .75)],
    [(0, "F#4", .75), (1, "B4", .75), (2, "D5", 1), (3, "E5", .75)],
    [(0, "D5", 1.5), (1.5, "B4", .5), (2, "A4", 1.75)],
    [(0, "G4", 1), (1, "B4", .5), (1.5, "D5", .5), (2, "B4", 1), (3, "A4", .75)],
    [(0, "F#4", 1.5), (1.5, "A4", .5), (2, "E5", 1), (3, "D5", .75)],
    [(0, "B4", 1), (1, "D5", .5), (1.5, "B4", .5), (2, "A4", 1), (3, "G4", .75)],
    [(0, "A4", 1.5), (1.5, "G4", .5), (2, "E4", 1.75)],
    [(0, "B4", 1.5), (1.5, "C#5", .5), (2, "D5", 1), (3, "F#5", .75)],
    [(0, "E5", 1.5), (1.5, "C#5", .5), (2, "A4", 1.75)],
    [(0, "B4", 1), (1, "D5", 1), (2, "G5", 1), (3, "F#5", .75)],
    [(0, "E5", 1.5), (1.5, "D5", .5), (2, "A4", 1.75)],
    [(0, "B4", 1), (1, "G4", .5), (1.5, "A4", .5), (2, "B4", 1), (3, "D5", .75)],
    [(0, "C#5", 1.5), (1.5, "B4", .5), (2, "F#4", 1.75)],
    [(0, "G4", 1), (1, "A4", .5), (1.5, "B4", .5), (2, "D5", 1), (3, "B4", .75)],
    [(0, "A4", 1), (1, "G4", .5), (1.5, "F#4", .5), (2, "E4", 1.75)],
    [(0, "F#4", 1), (1, "A4", .5), (1.5, "B4", .5), (2, "A4", 1), (3, "F#4", .75)],
    [(0, "E4", 1.5), (1.5, "F#4", .5), (2, "A4", 1), (3, "E4", .75)],
    [(0, "F#4", 1), (1, "B4", 1), (2, "D5", 1), (3, "C#5", .5), (3.5, "B4", .5)],
    [(0, "A4", 1.5), (1.5, "F#4", .5), (2, "G4", 1.75)],
    [(0, "G4", 1), (1, "B4", .5), (1.5, "A4", .5), (2, "F#4", 1), (3, "E4", .75)],
    [(0, "F#4", 1.5), (1.5, "A4", .5), (2, "D5", 1), (3, "A4", .75)],
    [(0, "G4", 1), (1, "F#4", 1), (2, "E4", 1.75)],
    [(0, "F#4", 1), (1, "E4", 1), (2, "D4", 3.2)],
]


def run():
    print(f"Rendering {DURATION:.2f} s at {SR} Hz: original 32-bar score", flush=True)
    piano = np.zeros((N, 2), np.float32)
    pads = np.zeros((N, 2), np.float32)
    stars = np.zeros((N, 2), np.float32)
    for bar, chord_name in enumerate(PROGRESSION):
        when = LEAD + bar * BAR
        bass, voices, arp = CHORDS[chord_name]
        # A gentle swell toward the contrasting third section, then a quiet return.
        section_gain = [1., 1.07, 1.12, .91][bar // 8]
        if bar >= 29:
            section_gain *= [1., .89, .82][bar - 29]
        insert(pads, pad(bass, BAR + .05, bar * .47), when, .013 * section_gain)
        for j, voice in enumerate(voices):
            insert(pads, pad(voice, BAR + .07, j * 1.6 + bar * .32), when + j * .018, .014 * section_gain)
        # Left hand: a low, soft octave-free root followed by a lilting broken voicing.
        insert(piano, felt_piano(bass, 2.6 * BEAT, .60), when, .105 * section_gain, -.31)
        accompaniment = [(0.5, 0), (1.5, 1), (2.5, 2), (3.5, 1)]
        if bar in [3, 7, 11, 15, 19, 23, 27, 30]:
            accompaniment = [(0.5, 0), (1.5, 1), (2.5, 2)]
        if bar == 31:
            accompaniment = [(.12, 0), (.22, 1), (.32, 2)]
        for beat, j in accompaniment:
            micro = RNG.uniform(-.009, .009)
            insert(piano, felt_piano(arp[j], (1.5 if bar != 31 else 4.1) * BEAT, .47 + RNG.uniform(-.04, .04)),
                   when + beat * BEAT + micro, .093 * section_gain, -.22 + j * .13)
        for ni, (beat, note, length) in enumerate(MELODY[bar]):
            # Small timing and dynamic inflections retain the intentional sung rhythm.
            micro = RNG.uniform(-.011, .017)
            velocity = .75 + RNG.uniform(-.025, .025)
            if ni == 0:
                velocity += .03
            if bar // 8 == 2:
                velocity += .025
            if bar >= 30:
                velocity -= .055
            insert(piano, felt_piano(note, length * BEAT + .28, velocity),
                   when + beat * BEAT + .024 + micro, .192 * section_gain, .11)
        if bar % 8 == 7:
            print(f"  scored bars 1–{bar + 1}", flush=True)
    # Constellation highlights: only twelve individual bell notes in the whole piece.
    for bar, beat, note, pan in [
        (1, 2.5, "E6", .55), (4, 3, "B5", -.53), (7, 2, "A5", .37),
        (9, 2.5, "E6", -.47), (12, 3, "F#6", .53), (15, 2, "A5", -.35),
        (18, 2, "G6", .51), (20, 3, "B5", -.55), (23, 2, "E6", .32),
        (25, 2.5, "E6", -.45), (28, 3, "B5", .50), (31, 2, "D6", -.23),
    ]:
        insert(stars, star(note), LEAD + bar * BAR + beat * BEAT, .031 if bar < 24 else .024, pan)
    print("Rendering stereo space…", flush=True)
    mix = piano + pads + stars
    mix += reverb(piano, decay=3.1, wet=.205, seed=7)
    mix += reverb(stars, decay=4.1, wet=.27, seed=11)
    # Remove inaudible DC and soften the very highest frequencies.
    mix = signal.sosfilt(signal.butter(2, 40, btype="highpass", fs=SR, output="sos"), mix, axis=0)
    mix = signal.sosfilt(signal.butter(2, 12500, fs=SR, output="sos"), mix, axis=0)
    fadein = round(2.0 * SR)
    fadeout = round(4.4 * SR)
    mix[:fadein] *= (np.sin(np.linspace(0, np.pi / 2, fadein)) ** 2)[:, None]
    mix[-fadeout:] *= (np.cos(np.linspace(0, np.pi / 2, fadeout)) ** 2)[:, None]
    mix *= 10 ** (-3.0 / 20) / np.max(np.abs(mix))
    raw = HERE / "starsea-unnormalized.wav"
    wavfile.write(raw, SR, (mix * 32767).astype(np.int16))
    # Two-pass integrated loudness normalization preserves the performance dynamics.
    first = subprocess.run([
        "ffmpeg", "-hide_banner", "-i", str(raw), "-af",
        "loudnorm=I=-19:TP=-2:LRA=10:print_format=json", "-f", "null", "-"
    ], capture_output=True, text=True, check=True)
    norm = json.loads(first.stderr[first.stderr.rfind("{"):])
    af = ("loudnorm=I=-19:TP=-2:LRA=10:linear=true:"
          f"measured_I={norm['input_i']}:measured_TP={norm['input_tp']}:"
          f"measured_LRA={norm['input_lra']}:measured_thresh={norm['input_thresh']}:"
          f"offset={norm['target_offset']}")
    master = HERE / "starsea-awake-master.wav"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw),
                    "-af", af, "-ar", str(SR), "-c:a", "pcm_s16le", str(master)], check=True)
    mp3 = HERE / "starsea-awake.mp3"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(master),
                    "-c:a", "libmp3lame", "-b:a", "96k", "-ar", str(SR),
                    "-metadata", "title=星海未眠", "-metadata", "artist=Original composition",
                    "-metadata", "comment=Original synthesized instrumental; 68 BPM; D major; 32 bars",
                    str(mp3)], check=True)
    excerpt = HERE / "starsea-awake-excerpt.wav"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", "28.4", "-i", str(master),
                    "-t", "15", "-af", "afade=t=in:d=0.5,afade=t=out:st=13.8:d=1.2",
                    "-c:a", "pcm_s16le", str(excerpt)], check=True)
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(excerpt),
                    "-c:a", "libmp3lame", "-b:a", "96k", str(HERE / "starsea-awake-excerpt.mp3")], check=True)
    # Analyze the actual delivered MP3, so encoding overshoot is included.
    check = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(mp3), "-af",
                            "loudnorm=I=-19:TP=-2:LRA=10:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, check=True)
    metrics = json.loads(check.stderr[check.stderr.rfind("{"):])
    sample_rate, pcm = wavfile.read(master)
    decoded = pcm.astype(np.float64) / 32768.
    metrics_out = {
        "title": "星海未眠",
        "duration_seconds": len(pcm) / sample_rate,
        "bpm": BPM,
        "meter": "4/4",
        "key": "D major",
        "bars": 32,
        "sections": ["A: bars 1–8", "A variation: bars 9–16", "B: bars 17–24", "Return: bars 25–32"],
        "mp3_bytes": mp3.stat().st_size,
        "mp3_bitrate_kbps": 96,
        "mp3_integrated_lufs": float(metrics["input_i"]),
        "mp3_true_peak_dbtp": float(metrics["input_tp"]),
        "mp3_loudness_range_lu": float(metrics["input_lra"]),
        "master_sample_peak_dbfs": float(20 * np.log10(np.max(np.abs(decoded)))),
        "master_rms_dbfs": float(20 * np.log10(np.sqrt(np.mean(decoded ** 2)))),
        "master_clipped_samples": int(np.sum(np.abs(pcm.astype(np.int32)) >= 32767)),
        "stereo_correlation": float(np.corrcoef(decoded.T)[0, 1]),
        "master_first_sample": decoded[0].tolist(),
        "master_last_sample": decoded[-1].tolist(),
    }
    (HERE / "audio-checks.json").write_text(json.dumps(metrics_out, indent=2, ensure_ascii=False) + "\n")
    raw.unlink()
    print(json.dumps(metrics_out, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    run()
