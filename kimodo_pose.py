#!/usr/bin/env python3
"""kimodo motion -> OpenPose control image, for driving the weiner Klein LoRA.

The kimodo motion API (http://HOST:7862) returns, per clip, `posed_joints` [T,22,3]:
world-space 3D positions of the 22 SMPL-X body joints (y-up, metres). This module
projects a chosen frame to 2D and draws a canonical OpenPose (COCO-18) colored
skeleton — the abstract pose anchor that FLUX.2 Klein follows WITHOUT donating any
material (unlike a textured mannequin), so the weiner identity/LoRA supplies looks.

Pipeline:  kimodo /animations/{id}  ->  openpose_png(frame)  ->  klein /generate
           image=[skeleton, weiner_identity_shot], lora=weiner

CLI:
    python kimodo_pose.py <anim_id> <out.png> [--frame N | --peak foot|hand] [--view front|side|auto]
"""
from __future__ import annotations

import argparse
import json
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

KIMODO_URL = "http://127.0.0.1:7862"

# SMPL-X 22-joint order returned by the kimodo API (see /info bone_names).
SMPLX = {
    "pelvis": 0, "left_hip": 1, "right_hip": 2, "spine1": 3, "left_knee": 4,
    "right_knee": 5, "spine2": 6, "left_ankle": 7, "right_ankle": 8, "spine3": 9,
    "left_foot": 10, "right_foot": 11, "neck": 12, "left_collar": 13,
    "right_collar": 14, "head": 15, "left_shoulder": 16, "right_shoulder": 17,
    "left_elbow": 18, "right_elbow": 19, "left_wrist": 20, "right_wrist": 21,
}

# OpenPose COCO-18 keypoint index -> source SMPL-X joint (eyes/ears synthesized below).
OP_FROM_SMPLX = {
    0: "head",            # nose ~ head
    1: "neck", 2: "right_shoulder", 3: "right_elbow", 4: "right_wrist",
    5: "left_shoulder", 6: "left_elbow", 7: "left_wrist",
    8: "right_hip", 9: "right_knee", 10: "right_ankle",
    11: "left_hip", 12: "left_knee", 13: "left_ankle",
}
# OpenPose limb pairs (COCO-18) + canonical colors (R,G,B).
OP_LIMBS = [
    (1, 2, (255, 0, 0)), (1, 5, (255, 85, 0)), (2, 3, (255, 170, 0)),
    (3, 4, (255, 255, 0)), (5, 6, (170, 255, 0)), (6, 7, (85, 255, 0)),
    (1, 8, (0, 255, 0)), (8, 9, (0, 255, 85)), (9, 10, (0, 255, 170)),
    (1, 11, (0, 255, 255)), (11, 12, (0, 170, 255)), (12, 13, (0, 85, 255)),
    (1, 0, (0, 0, 255)), (0, 14, (85, 0, 255)), (14, 16, (170, 0, 255)),
    (0, 15, (255, 0, 255)), (15, 17, (255, 0, 170)),
]
OP_POINT_COLOR = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0),
    (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255),
    (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255),
    (255, 0, 255), (255, 0, 170), (255, 0, 85),
]


def fetch(anim_id: str, url: str = KIMODO_URL) -> dict:
    return json.load(urllib.request.urlopen(f"{url}/animations/{anim_id}", timeout=30))


def peak_frame(P: np.ndarray, what: str = "foot") -> int:
    """Frame where the action reads clearest: foot/hand at max height (kick/punch peak)."""
    idx = [SMPLX["left_foot"], SMPLX["right_foot"], SMPLX["left_ankle"], SMPLX["right_ankle"]] \
        if what == "foot" else [SMPLX["left_wrist"], SMPLX["right_wrist"]]
    return int(P[:, idx, 1].max(axis=1).argmax())


def _project(J: np.ndarray, view: str):
    """3D world joints [22,3] (y up) -> 2D [22,2] in image space. front: x-y; side: z-y."""
    x, y, z = J[:, 0], J[:, 1], J[:, 2]
    if view == "auto":
        view = "side" if z.std() > x.std() * 1.15 else "front"
    h = x if view == "front" else z
    return np.stack([h, y], axis=1), view  # (horizontal, vertical-up)


def openpose_image(P_frame: np.ndarray, size: int = 1024, view: str = "auto",
                   pad: float = 0.14) -> Image.Image:
    """Draw a COCO-18 OpenPose skeleton for one frame's [22,3] joints on black."""
    pts2d, _ = _project(P_frame, view)
    # build the 18 OpenPose keypoints
    kp = np.full((18, 2), np.nan)
    for op_i, name in OP_FROM_SMPLX.items():
        kp[op_i] = pts2d[SMPLX[name]]
    # synthesize eyes/ears around the head so the face limbs render
    head, neck = pts2d[SMPLX["head"]], pts2d[SMPLX["neck"]]
    up = (head - neck); span = np.linalg.norm(up) + 1e-6; up = up / span
    side = np.array([-up[1], up[0]]) * span * 0.25
    kp[0] = head + up * span * 0.15                 # nose
    kp[14], kp[15] = head + side * 0.6, head - side * 0.6   # R/L eye
    kp[16], kp[17] = head + side, head - side              # R/L ear

    # normalize into the canvas (preserve aspect, feet at bottom, head at top)
    valid = kp[~np.isnan(kp).any(axis=1)]
    hmin, hmax = valid[:, 0].min(), valid[:, 0].max()
    vmin, vmax = valid[:, 1].min(), valid[:, 1].max()
    s = (1 - 2 * pad) * size / max(hmax - hmin, vmax - vmin, 1e-6)
    cu = size / 2 - (hmin + hmax) / 2 * s
    cv = size / 2 + (vmin + vmax) / 2 * s

    def to_px(p):
        return (cu + p[0] * s, cv - p[1] * s)  # flip vertical (y-up -> image-down)

    img = Image.new("RGB", (size, size), (0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = max(4, size // 160)
    for a, b, c in OP_LIMBS:
        if np.isnan(kp[a]).any() or np.isnan(kp[b]).any():
            continue
        d.line([to_px(kp[a]), to_px(kp[b])], fill=c, width=lw)
    r = max(4, size // 200)
    for i, p in enumerate(kp):
        if np.isnan(p).any():
            continue
        x, y = to_px(p)
        d.ellipse([x - r, y - r, x + r, y + r], fill=OP_POINT_COLOR[i])
    return img


def render_anim_frame(anim_id, out, frame=None, peak="foot", view="auto", url=KIMODO_URL):
    rec = fetch(anim_id, url)
    P = np.array(rec["posed_joints"])
    f = peak_frame(P, peak) if frame is None else int(frame)
    img = openpose_image(P[f], view=view)
    img.save(out)
    print(f"saved {out}  anim={anim_id} frame={f}/{P.shape[0]} view={view} prompt={rec.get('prompt','')[:60]!r}")
    return f


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("anim_id")
    ap.add_argument("out")
    ap.add_argument("--frame", type=int, default=None)
    ap.add_argument("--peak", choices=["foot", "hand"], default="foot")
    ap.add_argument("--view", choices=["front", "side", "auto"], default="auto")
    ap.add_argument("--url", default=KIMODO_URL)
    a = ap.parse_args()
    render_anim_frame(a.anim_id, a.out, a.frame, a.peak, a.view, a.url)
