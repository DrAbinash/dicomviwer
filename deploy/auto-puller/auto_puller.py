#!/usr/bin/env python3
"""
DICOM Viewer - Phase 2 Auto Puller
==================================

Polls configured DICOM modalities (C-FIND), detects studies that are missing
from the local Orthanc gateway, and retrieves them automatically (C-MOVE).
Stops depending on technician-controlled auto-send on the modality consoles.

Everything is configured through environment variables - nothing is hardcoded:

    ORTHANC_URL              e.g. http://orthanc:8042
    ORTHANC_USERNAME         optional basic-auth user
    ORTHANC_PASSWORD         optional basic-auth password
    TARGET_AET               AE title of the local gateway (C-MOVE target),
                             must match DicomAet in orthanc.json
    POLL_INTERVAL_SECONDS    seconds between cycles          (default 300)
    LOOKBACK_DAYS            study-date range to query      (default 1)
    MODALITIES               comma list, ":" suffix toggles:
                             "UIH_MRI:on,CT_MACHINE:off,XRAY_1:on"
                             (default: every modality known to Orthanc, on)
    MAX_RETRIEVES_PER_CYCLE  safety cap per cycle           (default 20)
    FAIL_COOLDOWN_MINUTES    minutes before retrying a failed study (default 30)
    RUN_ONCE                 "1" = single cycle, then exit (for cron users)
    HEARTBEAT_URL            optional viewer endpoint that records activity,
                             e.g. http://viewer:3000/api/auto-pull/heartbeat
    HEARTBEAT_TOKEN          optional shared secret (x-auto-pull-token header)
    LOG_LEVEL                DEBUG / INFO / WARNING         (default INFO)

Based on the Care Diagnostics field script (orthanc_auto_puller.py).
"""

import datetime
import logging
import os
import signal
import time
from typing import Any, Dict, List, Optional

import requests

# --------------------------------------------------------------------------
# Configuration (environment only - no hardcoded site values)
# --------------------------------------------------------------------------

ORTHANC_URL = os.getenv("ORTHANC_URL", "http://orthanc:8042").rstrip("/")
ORTHANC_USERNAME = os.getenv("ORTHANC_USERNAME", "")
ORTHANC_PASSWORD = os.getenv("ORTHANC_PASSWORD", "")
TARGET_AET = os.getenv("TARGET_AET", "ORTHANC2")

POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "300"))
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "1"))
MAX_RETRIEVES_PER_CYCLE = int(os.getenv("MAX_RETRIEVES_PER_CYCLE", "20"))
FAIL_COOLDOWN_MINUTES = int(os.getenv("FAIL_COOLDOWN_MINUTES", "30"))
RUN_ONCE = os.getenv("RUN_ONCE", "") == "1"

HEARTBEAT_URL = os.getenv("HEARTBEAT_URL", "").rstrip("/")
HEARTBEAT_TOKEN = os.getenv("HEARTBEAT_TOKEN", "")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# "UIH_MRI:on,CT_MACHINE:off" | "UIH_MRI,CT_MACHINE" (all on) | "" = all on
RAW_MODALITIES = os.getenv("MODALITIES", "")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("auto-puller")

# --------------------------------------------------------------------------
# Runtime state
# --------------------------------------------------------------------------

_stop = False
_failures: Dict[str, float] = {}  # "modality|studyUid" -> epoch of last failure


def parse_modalities(raw: str) -> List[Dict[str, Any]]:
    """Parse the MODALITIES env var into [{name, enabled}]. Empty = all on."""
    out: List[Dict[str, Any]] = []
    for chunk in filter(None, [c.strip() for c in raw.split(",")]):
        name, sep, flag = chunk.partition(":")
        name = name.strip()
        if not name:
            continue
        flag = flag.strip().lower()
        enabled = True if not sep else flag in ("on", "1", "true", "yes", "y", "enabled")
        out.append({"name": name, "enabled": enabled})
    return out


def auth():
    if ORTHANC_USERNAME or ORTHANC_PASSWORD:
        return (ORTHANC_USERNAME, ORTHANC_PASSWORD)
    return None


# --------------------------------------------------------------------------
# Orthanc REST helpers
# --------------------------------------------------------------------------

def orthanc_get(path: str) -> Any:
    r = requests.get(ORTHANC_URL + path, auth=auth(), timeout=60)
    r.raise_for_status()
    return r.json()


def orthanc_post(path: str, payload: Dict[str, Any], timeout: int = 120) -> Any:
    r = requests.post(ORTHANC_URL + path, json=payload, auth=auth(), timeout=timeout)
    r.raise_for_status()
    if r.text.strip():
        return r.json()
    return None


def date_query() -> str:
    since = datetime.date.today() - datetime.timedelta(days=LOOKBACK_DAYS)
    return since.strftime("%Y%m%d") + "-"


def known_modalities() -> List[str]:
    try:
        return list(orthanc_get("/modalities"))
    except Exception as e:
        log.error("Cannot list modalities: %s", e)
        return []


def extract_value(v):
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, dict):
        if isinstance(v.get("Value"), str):
            return v["Value"].strip()
        if isinstance(v.get("Value"), list) and v["Value"]:
            return str(v["Value"][0]).strip()
    return ""


def get_tag(content: Dict[str, Any], tag: str, keyword: str = "") -> str:
    if keyword and keyword in content:
        return extract_value(content[keyword])
    if tag in content:
        return extract_value(content[tag])
    lower = tag.lower()
    if lower in content:
        return extract_value(content[lower])
    return ""


def local_study_exists(study_uid: str) -> bool:
    result = orthanc_post("/tools/find", {
        "Level": "Study",
        "Query": {"StudyInstanceUID": study_uid},
    })
    return isinstance(result, list) and len(result) > 0


# --------------------------------------------------------------------------
# Per-modality cycle
# --------------------------------------------------------------------------

def query_modality(modality: str) -> Optional[str]:
    payload = {
        "Level": "Study",
        "Query": {
            "StudyDate": date_query(),
            "PatientName": "",
            "PatientID": "",
            "AccessionNumber": "",
            "StudyInstanceUID": "",
            "StudyDescription": "",
            "ModalitiesInStudy": "",
        },
    }
    log.info("Querying %s with StudyDate=%s", modality, payload["Query"]["StudyDate"])
    result = orthanc_post(f"/modalities/{modality}/query", payload)
    if not isinstance(result, dict) or "ID" not in result:
        log.error("Query returned unexpected response for %s: %s", modality, result)
        return None
    return result["ID"]


def retrieve_answer(query_id: str, answer_id: str) -> bool:
    try:
        orthanc_post(
            f"/queries/{query_id}/answers/{answer_id}/retrieve",
            {"TargetAet": TARGET_AET},
        )
        return True
    except Exception as e:
        log.error("Retrieve submit failed query=%s answer=%s error=%s",
                  query_id, answer_id, e)
        return False


def process_modality(modality: str, events: List[Dict[str, Any]]) -> None:
    """C-FIND one modality; queue retrieves for studies missing locally."""
    try:
        query_id = query_modality(modality)
        if not query_id:
            return

        answers = orthanc_get(f"/queries/{query_id}/answers")
        if not isinstance(answers, list):
            log.error("Unexpected answers for %s: %s", modality, answers)
            return

        log.info("%s returned %d studies", modality, len(answers))
        retrieved = 0

        for answer_id in answers:
            if retrieved >= MAX_RETRIEVES_PER_CYCLE:
                log.warning("Cap of %d retrieves/cycle reached on %s",
                            MAX_RETRIEVES_PER_CYCLE, modality)
                break

            content = orthanc_get(f"/queries/{query_id}/answers/{answer_id}/content")
            uid = get_tag(content, "0020,000D", "StudyInstanceUID")
            patient_name = get_tag(content, "0010,0010", "PatientName")
            patient_id = get_tag(content, "0010,0020", "PatientID")
            study_desc = get_tag(content, "0008,1030", "StudyDescription")
            accession = get_tag(content, "0008,0050", "AccessionNumber")

            if not uid:
                log.warning("Skipping answer %s: no StudyInstanceUID", answer_id)
                continue

            base_event = {
                "sourceAet": modality,
                "studyUid": uid,
                "patientName": patient_name,
                "patientId": patient_id,
                "studyDescription": study_desc,
                "accessionNumber": accession,
            }

            if local_study_exists(uid):
                log.info("Already present: %s | %s | %s", uid, patient_id, patient_name)
                events.append({**base_event, "action": "skipped",
                               "detail": "already present"})
                continue

            key = f"{modality}|{uid}"
            last_fail = _failures.get(key, 0)
            if time.time() - last_fail < FAIL_COOLDOWN_MINUTES * 60:
                events.append({**base_event, "action": "skipped",
                               "detail": "cooling down after earlier failure"})
                continue

            log.warning(
                "MISSING STUDY: pulling %s | Patient=%s %s | Accession=%s | Desc=%s",
                uid, patient_id, patient_name, accession, study_desc,
            )
            if retrieve_answer(query_id, str(answer_id)):
                retrieved += 1
                events.append({**base_event, "action": "pulled",
                               "detail": "retrieve submitted"})
            else:
                _failures[key] = time.time()
                events.append({**base_event, "action": "failed",
                               "detail": "retrieve submit failed"})

    except Exception as e:
        log.exception("Modality cycle failed for %s: %s", modality, e)
        events.append({
            "sourceAet": modality, "studyUid": f"cycle-error-{int(time.time())}",
            "action": "failed", "detail": str(e)[:200],
        })


# --------------------------------------------------------------------------
# Heartbeat -> viewer activity log (Settings > Auto-Pull tab)
# --------------------------------------------------------------------------

def send_heartbeat(status: str, started: datetime.datetime,
                   modalities: List[Dict[str, Any]],
                   events: List[Dict[str, Any]]) -> None:
    if not HEARTBEAT_URL:
        return
    body = {
        "status": status,
        "startedAt": started.isoformat(),
        "finishedAt": datetime.datetime.now().isoformat(),
        "pollIntervalSeconds": POLL_INTERVAL_SECONDS,
        "lookbackDays": LOOKBACK_DAYS,
        "targetAet": TARGET_AET,
        "modalities": modalities,
        "events": events,
    }
    headers = {}
    if HEARTBEAT_TOKEN:
        headers["x-auto-pull-token"] = HEARTBEAT_TOKEN
    try:
        r = requests.post(HEARTBEAT_URL, json=body, headers=headers, timeout=30)
        r.raise_for_status()
        log.info("Heartbeat sent (%d events)", len(events))
    except Exception as e:
        log.error("Heartbeat failed: %s", e)


# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------

def run_once() -> None:
    started = datetime.datetime.now()
    events: List[Dict[str, Any]] = []
    modality_report: List[Dict[str, Any]] = []
    status = "ok"

    try:
        system = orthanc_get("/system")
        log.info("Connected to Orthanc: Name=%s AET=%s Port=%s",
                 system.get("Name"), system.get("DicomAet"), system.get("DicomPort"))
    except Exception as e:
        log.error("Cannot connect to Orthanc at %s: %s", ORTHANC_URL, e)
        send_heartbeat("error", started,
                       [{"name": "connect", "enabled": True, "error": str(e)[:200]}], [])
        return

    configured = parse_modalities(RAW_MODALITIES)
    if configured:
        known = known_modalities()
        targets = [m for m in configured if m["name"] in known or not known]
        # report configured-but-unknown entries so the UI exposes typos
        for m in configured:
            if m["name"] not in known:
                modality_report.append({**m, "error": "not registered on Orthanc"})
    else:
        targets = [{"name": n, "enabled": True} for n in known_modalities()]

    had_error = False
    for m in targets:
        if _stop:
            break
        if not m.get("enabled"):
            continue
        before = len([e for e in events if e.get("action") == "failed"])
        process_modality(m["name"], events)
        if len([e for e in events if e.get("action") == "failed"]) > before:
            had_error = True

    status = "partial" if had_error else "ok"
    send_heartbeat(status, started, modality_report, events)


def _handle_signal(signum, _frame):
    global _stop
    log.info("Received signal %s - shutting down after current step", signum)
    _stop = True


def main() -> None:
    logging.info("Auto Puller starting: url=%s target=%s interval=%ss lookback=%sd",
                 ORTHANC_URL, TARGET_AET, POLL_INTERVAL_SECONDS, LOOKBACK_DAYS)
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    while not _stop:
        run_once()
        if RUN_ONCE:
            break

        slept = 0
        while slept < POLL_INTERVAL_SECONDS and not _stop:
            time.sleep(1)
            slept += 1

    log.info("Auto Puller stopped")


if __name__ == "__main__":
    main()
