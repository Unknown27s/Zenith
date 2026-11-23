import csv
import io
import time
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from fastapi import HTTPException
from fastapi.responses import Response
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer
from sqlalchemy import select

from .config import DATA
from .db import Carbon, Equipment, Incident, Run, RunSummary
from .vision import incident_views, review_view


def build_report(session, owner, format, run_id):
    query = select(Incident).where(Incident.owner == owner)
    run_query = select(Run).where(Run.owner == owner)
    carbon_query = select(Carbon).where(Carbon.owner == owner)
    if run_id:
        query = query.where(Incident.run_id == run_id)
        run_query = run_query.where(Run.id == run_id)
        carbon_query = carbon_query.where(Carbon.payload['run_id'].as_string() == run_id)
    events = list(session.scalars(query))
    runs = list(session.scalars(run_query))
    summaries = {row.id: row for row in session.scalars(select(RunSummary).where(
        RunSummary.id.in_([run.id for run in runs]), RunSummary.owner == owner))} if runs else {}
    carbon = list(session.scalars(carbon_query))
    equipment = list(session.scalars(select(Equipment).where(Equipment.owner == owner))) if not run_id else []
    if format == 'csv':
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['type', 'id', 'source/run', 'status', 'source_seconds/kg', 'details'])
        def safe(value):
            text = str(value)
            return "'" + text if text.startswith(('=', '+', '-', '@', '\t', '\r', '\n')) else text
        for event in events:
            p = event.payload
            writer.writerow([safe(x) for x in ['incident', event.id, event.run_id, p['operator_status'], p['source_seconds'], p['title']]])
        for row in carbon:
            p = row.payload
            writer.writerow([safe(x) for x in ['carbon estimate', row.id, p.get('run_id', ''), p['coverage'], p['kg'], f"{p['formula']}; factor source: {p['factor_source']}; basis: {p['basis']}"]])
        for row in runs:
            details = [f"Raw counts: {row.payload.get('counts', {})}",
                       f"Run summary: {row.payload.get('findings', {}).get('summary', 'unavailable')}",
                       f"Crossing reviews: {row.payload.get('crossing_reviews', {})}"]
            summary = review_view(summaries.get(row.id))
            if summary['status'] == 'completed':
                details += [f"Vision summary: {summary['summary']}", f"Vision limitations: {summary['limitations']}"]
            writer.writerow([safe(x) for x in ['run', row.id, row.payload['source_name'], row.status, '', '; '.join(details)]])
        for row in equipment:
            p = row.payload
            hours = (p['on_seconds'] + (max(0, time.time()-p['state_since']) if p['state'] == 'on' else 0))/3600
            writer.writerow([safe(x) for x in ['operator equipment log', row.id, p['name'], p['state'], hours, 'Hours from operator-declared ON time; unknown intervals excluded; stale declarations can overstate runtime']])
        return Response(output.getvalue(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename=zenith-report.csv'})
    if format != 'pdf':
        raise HTTPException(404)
    output = io.BytesIO()
    styles = getSampleStyleSheet()
    story = []
    def text(value, style='BodyText'):
        story.append(Paragraph(escape(str(value)), styles[style]))
        story.append(Spacer(1, 8))
    text('ZENITH | Safety & carbon report', 'Title')
    text(datetime.now(timezone.utc).strftime('Generated %Y-%m-%d %H:%M UTC'))
    text('Operator-key workspace. Suspected observations require human review. Emissions are estimates, not sensor measurements or a complete inventory.')
    for run in runs:
        text(f"Run {run.id} · {run.payload['source_name']}", 'Heading2')
        text(f"Status: {run.status}; coverage: {run.payload.get('coverage')}; model/rule: {run.payload['rule']['capability']} / v1")
        text(f"Vehicle crossings: {run.payload.get('counts', {})}; activity proxy seconds: {run.payload.get('activity_seconds', 'N/A')}")
        if run.payload.get('findings'):
            text(f"Analysis summary: {run.payload['findings']['summary']}")
            text(f"Limitations: {run.payload['findings']['limitations']}")
        summary = review_view(summaries.get(run.id))
        if summary['status'] == 'completed':
            text(f"Sampled-frame vision summary ({summary['model']}): {summary['summary']}")
            text(f"Vision limitations: {summary['limitations']}")
        for track_id, review in run.payload.get('crossing_reviews', {}).items():
            text(f"Crossing #{track_id}: {review['action']}; operator note: {review['note']}")
        if run.payload.get('analysis_settings'):
            text(f"Actual analysis configuration: {run.payload['analysis_settings']}")
    text('Safety evidence', 'Heading1')
    if not events:
        text('No incidents recorded within this selection. This is not proof that the footage is safe.')
    for p in incident_views(session, events):
        text(f"{p['title']} · source {p['source_seconds']:.2f}s", 'Heading2')
        text(f"{p['detail']} Operator: {p['operator_status']}. AI review: {p.get('ai_review', 'unavailable')}.")
        review = p['vision_review']
        if review['status'] == 'completed':
            text(f"Vision model interpretation ({review['model']}): {review['summary']}")
            text(f"Limitations: {review['limitations']}")
        for frame in p.get('frames', []):
            path = DATA / 'evidence' / frame
            if path.is_file():
                image = Image(str(path))
                image.drawHeight = 1.65 * inch
                image.drawWidth = image.imageWidth / image.imageHeight * image.drawHeight
                if image.drawWidth > 6 * inch:
                    image.drawHeight *= 6 * inch / image.drawWidth
                    image.drawWidth = 6 * inch
                story.append(image)
        for item in p.get('history', []):
            text(f"{item['action']}: {item['note']}")
    text('Carbon estimates & assumptions', 'Heading1')
    if not carbon:
        text('No emission factors/activity entries configured. No carbon value has been invented.')
    for row in carbon:
        p = row.payload
        text(f"{p['name']}: {p['kg']:.6g} kg {p['label']}", 'Heading2')
        text(p['formula'])
        text(f"Factor source: {p['factor_source']}. Activity basis: {p['basis']}. Coverage: {p['coverage']}.")
    if equipment:
        text('Operator-declared machine operation', 'Heading1')
        text('These are operator declarations, not electrical sensor measurements. Unknown intervals are excluded; stale ON declarations can overstate runtime.')
        for row in equipment:
            p = row.payload
            hours = (p['on_seconds'] + (max(0, time.time()-p['state_since']) if p['state'] == 'on' else 0))/3600
            text(f"{p['name']}: {p['state'].upper()}, {hours:.6g} logged ON hours", 'Heading2')
            for entry in p['history']:
                at = datetime.fromtimestamp(entry['at'], timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
                text(f"{at}: {entry['from']} -> {entry['to']}; {entry['note']}")
    text('RTSP clips are delayed file analysis; stream outages are not covered by a full health watchdog. Collapse/PPE and escalation are not enabled.')
    SimpleDocTemplate(output, title='Zenith report', author='Team Zenith', rightMargin=40, leftMargin=40).build(story)
    return Response(output.getvalue(), media_type='application/pdf', headers={'Content-Disposition': 'attachment; filename=zenith-report.pdf'})
