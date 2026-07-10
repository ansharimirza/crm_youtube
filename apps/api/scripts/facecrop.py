#!/usr/bin/env python3
# Auto-reframe helper: sample a clip, follow the largest face horizontally, and emit an
# ffmpeg sendcmd file that pans a fixed-size crop box to keep the speaker centered.
# The pan is interpolated onto a fine grid and exponentially smoothed so it glides
# instead of stepping.
#
# Usage: facecrop.py <video> <start_sec> <dur_sec> <ratio_w> <ratio_h> <out_cmds_path>
# Prints JSON: {"cropW":..., "cropH":..., "startX":...} on success.

import sys, os, json
import cv2

video, start, dur = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
rw, rh, out_cmds = float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]

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
center_x = maxX / 2.0

cascade = cv2.CascadeClassifier(CASCADE_PATH)
DETECT_W = 640.0
scale = DETECT_W / W

# 1) Sample face centre-x only where a face is actually detected (gaps get bridged later).
SAMPLE = 0.3
samples = []  # (t_rel, crop_x_target)
t = 0.0
while t < dur:
    cap.set(cv2.CAP_PROP_POS_MSEC, (start + t) * 1000.0)
    ok, frame = cap.read()
    if not ok:
        break
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (int(DETECT_W), int(H * scale)))
    faces = cascade.detectMultiScale(small, 1.15, 4, minSize=(28, 28))
    if len(faces):
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        cx = (x + w / 2.0) / scale
        samples.append((t, max(0.0, min(float(maxX), cx - cropW / 2.0))))
    t += SAMPLE
cap.release()

if not samples:
    samples = [(0.0, center_x)]

# Median-filter the raw targets to reject single-frame detection outliers (jitter).
if len(samples) >= 3:
    ts = [s[0] for s in samples]
    xs = [s[1] for s in samples]
    med = []
    for i in range(len(xs)):
        lo, hi = max(0, i - 2), min(len(xs), i + 3)
        win = sorted(xs[lo:hi])
        med.append(win[len(win) // 2])
    samples = list(zip(ts, med))

# 2) Interpolate onto a fine grid, then ease toward it with a slow EMA + a deadzone so the
# shot stays locked for small head movements and only pans for real motion.
GRID = 1.0 / 15.0
alpha = 0.07                      # slow, calm follow
deadzone = max(10.0, W * 0.05)    # px of face drift tolerated before the crop moves


def interp(tt):
    if tt <= samples[0][0]:
        return samples[0][1]
    if tt >= samples[-1][0]:
        return samples[-1][1]
    for i in range(1, len(samples)):
        if samples[i][0] >= tt:
            t0, x0 = samples[i - 1]
            t1, x1 = samples[i]
            return x0 if t1 == t0 else x0 + (x1 - x0) * (tt - t0) / (t1 - t0)
    return samples[-1][1]


n = max(1, int(dur / GRID) + 1)
grid = [i * GRID for i in range(n)]
cur = interp(0.0)
lines = []
prev = None
for gt in grid:
    tgt = interp(gt)
    err = tgt - cur
    if abs(err) > deadzone:  # only chase when the face has really drifted
        cur += (err - (deadzone if err > 0 else -deadzone)) * alpha
    x = int(max(0, min(maxX, round(cur))))
    if x != prev:
        lines.append(f"{gt:.3f} crop x {x};")
        prev = x

with open(out_cmds, 'w') as f:
    f.write("\n".join(lines))

start_x = int(lines[0].split()[-1].rstrip(';')) if lines else int(round(center_x))
print(json.dumps({"cropW": cropW, "cropH": cropH, "startX": start_x}))
