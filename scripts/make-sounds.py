#!/usr/bin/env python3
"""Make Bit Browser's tiny 8-bit sound effects (square waves) as WAV files.

    python3 scripts/make-sounds.py

Writes apps/mobile/assets/sounds/{tab,block,levelup,click}.wav. Each sound is a
list of (frequency Hz, milliseconds) notes; edit them to taste.
"""
import math, os, struct, wave

RATE = 22050
VOLUME = 0.22
OUT = os.path.join(os.path.dirname(__file__), '..', 'apps', 'mobile', 'assets', 'sounds')

SOUNDS = {
    'tab': [(880, 40), (1320, 60)],
    'block': [(220, 30), (165, 45)],
    'levelup': [(523, 70), (659, 70), (784, 70), (1047, 160)],
    'click': [(1500, 18)],
}


def square(freq, ms):
    n = int(RATE * ms / 1000)
    out = []
    for i in range(n):
        if freq <= 0:
            out.append(0)
            continue
        v = 1 if math.sin(2 * math.pi * freq * i / RATE) >= 0 else -1
        fade = min(1.0, (n - i) / (RATE * 0.008))  # short fade-out, no clicks
        out.append(int(v * VOLUME * fade * 32767))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, notes in SOUNDS.items():
        samples = [s for f, ms in notes for s in square(f, ms)]
        path = os.path.join(OUT, f'{name}.wav')
        with wave.open(path, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(struct.pack(f'<{len(samples)}h', *samples))
        print('wrote', os.path.relpath(path))


if __name__ == '__main__':
    main()
