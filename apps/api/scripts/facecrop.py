#!/usr/bin/env python3
# Auto-reframe helper: sample a clip, follow the largest face horizontally, and emit an
# ffmpeg sendcmd file that pans a fixed-size crop box to keep the speaker centered.
#
# Usage: facecrop.py <video> <start_sec> <dur_sec> <ratio_w> <ratio_h> <out_cmds_path>
# Prints JSON: {"cropW":..., "cropH":..., "startX":...} on success.

import sys, os, json
import cv2

video, start, dur = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
rw, rh, out_cmds = float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]

# Cascade is bundled next to this script (Debian's python3-opencv ships no cascade data).
CASCADE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'haarcascade_frontalface_default.xml')

cap = cv2.VideoCapture(video)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1920
H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080

# Crop box that fills the target ratio using the full height (fallback to full width).
cropH = H
cropW = int(round(H * rw / rh))
if cropW > W:
    cropW, cropH = W, int(round(W * rh / rw))
maxX = max(0, W - cropW)

cascade = cv2.CascadeClassifier(CASCADE_PATH)
DETECT_W = 640.0
scale = DETECT_W / W

SAMPLE = 0.4  # seconds between samples
samples = []  # (t_rel, crop_x)
t = 0.0
last_x = maxX // 2
while t < dur:
    cap.set(cv2.CAP_PROP_POS_MSEC, (start + t) * 1000.0)
    ok, frame = cap.read()
    if not ok:
        break
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (int(DETECT_W), int(H * scale)))
    faces = cascade.detectMultiScale(small, 1.2, 5, minSize=(28, 28))
    if len(faces):
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        cx = (x + w / 2.0) / scale
        last_x = int(max(0, min(maxX, round(cx - cropW / 2.0))))
    samples.append((t, last_x))  # hold last position when no face this frame
    t += SAMPLE
cap.release()

if not samples:
    samples = [(0.0, maxX // 2)]

# Smooth with a moving average to avoid jitter.
win = 3
sm = []
for i, (tt, _) in enumerate(samples):
    lo, hi = max(0, i - win), min(len(samples), i + win + 1)
    avg = sum(v for _, v in samples[lo:hi]) / (hi - lo)
    sm.append((tt, int(round(avg))))

with open(out_cmds, 'w') as f:
    f.write("\n".join(f"{tt:.2f} crop x {x};" for tt, x in sm))

print(json.dumps({"cropW": cropW, "cropH": cropH, "startX": sm[0][1]}))
