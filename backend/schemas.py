import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Rule(StrictModel):
    capability: Literal['zone', 'traffic', 'machine_activity']
    name: str = Field(min_length=1, max_length=100)
    instruction: str = Field(default='', max_length=2000)
    points: list[tuple[float, float]] = Field(min_length=2, max_length=12)
    dwell_seconds: float = Field(default=2, ge=0.2, le=120)
    motion_threshold: float = Field(default=0.03, ge=0.001, le=0.9)
    confidence: float = Field(default=0.3, ge=0.1, le=0.9)
    image_size: Literal[416, 640, 960, 1280] = 640
    iou_threshold: float = Field(default=0.7, ge=0.1, le=0.9)
    analysis_fps: int = Field(default=8, ge=4, le=15)
    vehicle_classes: list[Literal['car', 'motorcycle', 'bus', 'truck']] = Field(default_factory=lambda: ['car', 'motorcycle', 'bus', 'truck'], min_length=1, max_length=4)
    # Multi-channel per rule: any mix of allowlisted email addresses and `telegram:<chat>` entries.
    recipients: list[str] = Field(default_factory=list, max_length=5)
    # Legacy single-recipient field, kept so older clients still work.
    recipient: str = Field(default='', max_length=254)
    # Suppress repeat alerts for the same rule fingerprint for this many seconds.
    alert_cooldown_seconds: float = Field(default=300, ge=0, le=86400)
    confirmed: Literal[True]

    @field_validator('recipients')
    @classmethod
    def clean_recipients(cls, value):
        cleaned = []
        for item in value:
            item = item.strip()
            if not item:
                raise ValueError('Recipients must not be blank')
            if len(item) > 254:
                raise ValueError('Recipient is too long')
            if item not in cleaned:
                cleaned.append(item)
        return cleaned

    @model_validator(mode='after')
    def geometry(self):
        if len(set(self.vehicle_classes)) != len(self.vehicle_classes):
            raise ValueError('Vehicle classes must not repeat')
        legacy = self.recipient.strip()
        if legacy and legacy not in self.recipients:
            self.recipients = [*self.recipients, legacy]
        if len(self.recipients) > 5:
            raise ValueError('At most five notification recipients per rule')
        if any(not math.isfinite(v) or v < 0 or v > 1 for p in self.points for v in p):
            raise ValueError('Geometry must use normalized coordinates between 0 and 1')
        if self.capability == 'traffic':
            if len(self.points) != 2 or math.dist(*self.points) < 0.05:
                raise ValueError('Draw a line with two distinct endpoints')
        else:
            if len(self.points) < 3:
                raise ValueError('Draw a polygon with at least three points')
            area = abs(sum(self.points[i][0] * self.points[(i+1) % len(self.points)][1] - self.points[(i+1) % len(self.points)][0] * self.points[i][1] for i in range(len(self.points)))) / 2
            if area < 0.001:
                raise ValueError('Zone area is too small')
            def cross(a, b, c):
                return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
            n = len(self.points)
            for i in range(n):
                for j in range(i+2, n):
                    if i == 0 and j == n-1:
                        continue
                    a, b, c, d = self.points[i], self.points[(i+1)%n], self.points[j], self.points[(j+1)%n]
                    if cross(a,b,c)*cross(a,b,d) <= 0 and cross(c,d,a)*cross(c,d,b) <= 0:
                        raise ValueError('Zone edges must not intersect')
        return self


class RunRequest(StrictModel):
    source_id: str = Field(max_length=64)
    rule: Rule
    vision_provider: Literal['nvidia', 'local'] | None = None
    vision_consent: StrictBool = False


class CameraRequest(StrictModel):
    rule: Rule


class OperatorKeyRequest(StrictModel):
    label: str = Field(min_length=2, max_length=80, pattern=r'\S')


class ProposalRequest(StrictModel):
    instruction: str = Field(min_length=5, max_length=2000)


class Action(StrictModel):
    action: Literal['acknowledged', 'confirmed', 'dismissed']
    note: str = Field(default='', max_length=1000)


class CrossingReviewRequest(StrictModel):
    action: Literal['valid', 'false_positive']
    note: str = Field(min_length=3, max_length=500)


class EquipmentRequest(StrictModel):
    name: str = Field(min_length=1, max_length=100)


class EquipmentStateRequest(StrictModel):
    state: Literal['on', 'off', 'unknown']
    note: str = Field(min_length=3, max_length=500)


class CarbonRequest(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    kind: Literal['electricity', 'fuel', 'traffic']
    quantity: float = Field(ge=0, le=1e12)
    factor: float = Field(gt=0, le=1e9)
    factor_source: str = Field(min_length=3, max_length=1000)
    factor_id: str | None = Field(default=None, max_length=64)
    basis: str = Field(min_length=3, max_length=1000)
    hours: float = Field(default=1, ge=0, le=1e7)
    load_fraction: float = Field(default=1, gt=0, le=1)
    distance_km: float = Field(default=1, gt=0, le=1e6)
    run_id: str | None = Field(default=None, max_length=64)
    vehicle_class: Literal['car', 'motorcycle', 'bus', 'truck'] | None = None
    accept_activity_proxy: bool = False
    metered_kwh: float | None = Field(default=None, ge=0, le=1e12)

    @model_validator(mode='after')
    def validate_meter(self):
        if self.metered_kwh is not None and (self.kind != 'electricity' or self.accept_activity_proxy):
            raise ValueError('Metered kWh requires electricity and cannot be combined with the motion proxy')
        return self

    @field_validator('name', 'factor_source', 'basis')
    @classmethod
    def no_blank(cls, value):
        if not value.strip():
            raise ValueError('Cannot be blank')
        return value.strip()



class VisionReviewRequest(StrictModel):
    provider: Literal['nvidia', 'local']
    consent: StrictBool = False


class VisionInterpretation(StrictModel):
    model_config = ConfigDict(strict=True)

    summary: str = Field(min_length=1, max_length=600, pattern=r'\S')
    limitations: str = Field(min_length=1, max_length=400, pattern=r'\S')


class EmissionFactorRequest(StrictModel):
    name: str = Field(min_length=2, max_length=100, pattern=r'\S')
    kind: Literal['electricity', 'fuel', 'traffic']
    factor: float = Field(gt=0, le=1e9)
    source: str = Field(min_length=3, max_length=1000, pattern=r'\S')
    region: str = Field(min_length=2, max_length=100, pattern=r'\S')
    year: int = Field(ge=1900, le=2100)
    vehicle_class: Literal['car', 'motorcycle', 'bus', 'truck'] | None = None

    @model_validator(mode='after')
    def valid_class(self):
        if (self.kind == 'traffic') != (self.vehicle_class is not None):
            raise ValueError('Traffic factors require a vehicle class; other factors must not have one')
        return self
