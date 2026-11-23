"""Count tracked road traffic only after both finite gates are crossed."""


def line_side(a, b, point):
    return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])


def gate_crossing(start, end, a, b):
    first, last = line_side(a, b, start), line_side(a, b, end)
    if first * last >= 0:
        return None
    if line_side(start, end, a) * line_side(start, end, b) > 0:
        return None
    return first / (first - last), last > 0


class SegmentCounter:
    def __init__(self, points):
        self.gates = [(points[0], points[1]), (points[2], points[3])]
        self.previous = {}
        self.pending = {}

    def reset(self):
        self.previous.clear()
        self.pending.clear()

    def update(self, track_id, position, timestamp):
        previous = self.previous.get(track_id)
        self.previous[track_id] = (position, timestamp)
        if previous is None or timestamp - previous[1] > .75:
            self.pending.pop(track_id, None)
            return None

        crossings = []
        for gate, (a, b) in enumerate(self.gates):
            result = gate_crossing(previous[0], position, a, b)
            if result:
                fraction, positive = result
                crossings.append((fraction, gate, positive))
        for _, gate, positive in sorted(crossings):
            first = self.pending.pop(track_id, None)
            if first and first[0] != gate and first[1] == positive:
                return 'A→B' if first[0] == 0 else 'B→A'
            self.pending[track_id] = (gate, positive)
        return None
