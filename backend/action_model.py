"""Pose Transformer architecture used by Zenith_CCTV_AutoTrain_Colab."""
from collections import deque

import numpy as np
import torch
import torch.nn as nn

CLASSES = ["normal", "violence", "fall"]
T, P, K = 32, 4, 17  # window length (frames), max people per window, keypoints


def frame_tracks(r):
    """Ultralytics pose-track result -> {track_id: (17,3) [x,y,conf] normalized}."""
    if r.boxes is None or r.boxes.id is None or r.keypoints is None:
        return {}
    ids = r.boxes.id.int().cpu().tolist()
    xy = r.keypoints.xyn.cpu().numpy()
    cf = r.keypoints.conf
    cf = cf.cpu().numpy() if cf is not None else np.ones(xy.shape[:2], np.float32)
    kp = np.concatenate([xy, cf[..., None]], -1).astype(np.float32)
    return {i: kp[n] for n, i in enumerate(ids)}


def build_window(frames):
    """list of {id: (17,3)} (<= T long) -> array (P,T,17,3), or None if nobody visible."""
    frames = (list(frames) + [{}] * T)[:T]
    counts = {}
    for f in frames:
        for i in f:
            counts[i] = counts.get(i, 0) + 1
    if not counts:
        return None
    top = sorted(counts, key=counts.get, reverse=True)[:P]
    x = np.zeros((P, T, K, 3), np.float32)
    for p, i in enumerate(top):
        for t, f in enumerate(frames):
            if i in f:
                x[p, t] = f[i]
    return x

def feats(x):
    """x: (B,P,T,17,3) -> (B,P,T,89) motion-aware features."""
    xy, c = x[..., :2], x[..., 2]
    present = (c.sum(-1) > 0).float()                       # B,P,T
    hip = (xy[..., 11, :] + xy[..., 12, :]) / 2             # B,P,T,2
    rel = (xy - hip.unsqueeze(-2)) * present[..., None, None]
    pair = present[:, :, 1:] * present[:, :, :-1]
    vel = torch.zeros_like(xy)
    vel[:, :, 1:] = (xy[:, :, 1:] - xy[:, :, :-1]) * pair[..., None, None]
    hv = torch.zeros_like(hip)
    hv[:, :, 1:] = (hip[:, :, 1:] - hip[:, :, :-1]) * pair[..., None]
    return torch.cat([rel.flatten(-2), vel.flatten(-2), hip, hv, c], -1)


class Net(nn.Module):
    def __init__(self, n_classes, f_dim=89, d=128):
        super().__init__()
        self.inp = nn.Linear(f_dim, d)
        self.pos = nn.Parameter(torch.zeros(1, T, d))
        layer = nn.TransformerEncoderLayer(d, 4, 256, 0.1, batch_first=True)
        self.enc = nn.TransformerEncoder(layer, 2)
        self.head = nn.Sequential(nn.LayerNorm(d), nn.Linear(d, n_classes))

    def forward(self, x):
        B, P = x.shape[:2]
        pres = (x[..., 2].sum(-1) > 0).float()              # B,P,T
        h = self.enc(self.inp(feats(x).flatten(0, 1)) + self.pos)
        m = pres.flatten(0, 1).unsqueeze(-1)
        h = (h * m).sum(1) / m.sum(1).clamp(min=1)          # mean over visible frames
        h = h.view(B, P, -1)
        person = (pres.sum(-1) > 0).unsqueeze(-1)
        h = h.masked_fill(~person, -1e4).max(1).values      # max over people
        return self.head(h)


def load_classifier(path):
    if not path.is_file():
        raise ValueError('Upload the Colab action checkpoint in Settings before running fight and fall detection.')
    if path.stat().st_size > 8 * 1024**2:
        raise ValueError('The action checkpoint exceeds 8 MB.')
    checkpoint = torch.load(path, map_location='cpu', weights_only=True)
    if not isinstance(checkpoint, dict) or checkpoint.get('classes') != CLASSES:
        raise ValueError('Expected the Zenith Colab checkpoint with normal, violence and fall classes.')
    net = Net(len(CLASSES))
    net.load_state_dict(checkpoint['state'], strict=True)
    if any(not parameter.isfinite().all() for parameter in net.parameters()):
        raise ValueError('The action checkpoint contains invalid model parameters.')
    return net.eval()


class ActionMonitor:
    """Score a rolling pose window using the same shape as the training notebook."""

    def __init__(self, checkpoint, threshold):
        self.model = load_classifier(checkpoint)
        self.threshold = threshold
        self.frames = deque(maxlen=T)
        self.since_score = 0
        self.last_seen = None
        self.last_event = None

    def push(self, result, timestamp):
        if self.last_seen is not None and timestamp - self.last_seen > .5:
            self.frames.clear()
            self.since_score = 0
            self.last_event = None
        self.last_seen = timestamp
        self.frames.append(frame_tracks(result))
        self.since_score += 1
        if len(self.frames) == T and self.since_score >= 8:
            return self.score(timestamp)
        return None

    def score(self, timestamp):
        self.since_score = 0
        window = build_window(self.frames)
        if window is None or (window[..., 2] > 0).any(axis=-1).sum(axis=-1).max() < 4:
            return None
        with torch.inference_mode():
            scores = self.model(torch.from_numpy(window)[None]).softmax(-1)[0]
        index = int(scores.argmax())
        label = CLASSES[index]
        score = float(scores[index])
        if label == 'normal' or score < self.threshold:
            return None
        if self.last_event and timestamp - self.last_event[1] < 3 and self.last_event[0] == label:
            return None
        self.last_event = (label, timestamp)
        title = 'Possible physical fight' if label == 'violence' else 'Possible fall'
        return title, f'Pose classifier score {score:.0%}. Review the original clip to verify this observation.'
