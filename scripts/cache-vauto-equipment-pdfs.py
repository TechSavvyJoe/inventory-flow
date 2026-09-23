"""Keep one VIN-checked printable PDF per active vAuto equipment source.

The vAuto API supplies a PDF for most VINs. Where it only supplies a JPEG,
preserve that source as a clearly labeled, one-page PDF. No appraisal is edited.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageDraw, ImageFont, ImageOps
from pypdf import PdfReader

VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
CAI_PATH = re.compile(
    r"^/window-stickers/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpg)$",
    re.I,
)
MAX_SOURCE_BYTES = 8 * 1024 * 1024


def approved_source(value: object, extension: str) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value)
        match = CAI_PATH.fullmatch(parts.path)
        valid = (parts.scheme == "https" and parts.hostname == "assets.cai-media-management.com"
                 and not parts.port and not parts.username and not parts.password
                 and not parts.query and not parts.fragment and match and match.group(1).lower() == extension)
    except ValueError:
        return None
    if not valid:
        return None
    return value


def current_vins(root: Path, report_date: str) -> set[str]:
    snapshot = root / "work" / "inventory-history" / "snapshots" / f"{report_date}-public.json"
    data = json.loads(snapshot.read_text(encoding="utf-8"))
    if data.get("report_date") != report_date or data.get("completed") is not True:
        raise ValueError("Current public inventory is not complete")
    vehicles = data.get("vehicles") or {}
    vins = {vin for vin in vehicles if VIN_RE.fullmatch(vin)}
    dealer = root / "work" / "dealermail-history" / "snapshots" / f"{report_date}-complete-used-inventory-deep-cloud-ready.json"
    if dealer.exists():
        source = json.loads(dealer.read_text(encoding="utf-8"))
        if source.get("reportDate") != report_date or source.get("sourceStatus", {}).get("authenticatedSession") is not True:
            raise ValueError("Current DealerMail inventory is invalid")
        for row in source.get("completeDealerMailUsedInventory", {}).get("rows") or []:
            vin = str(row.get("vin") or "").strip().upper()
            if VIN_RE.fullmatch(vin):
                vins.add(vin)
    return vins


def captured_sources(root: Path, vins: set[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for file in sorted((root / "work" / "vauto-history").glob("*-factory-equipment.json")):
        data = json.loads(file.read_text(encoding="utf-8"))
        for record in data.get("records") or []:
            vin = record.get("vin")
            if vin not in vins or record.get("result") != "OK":
                continue
            content = record.get("content") or {}
            pdf = approved_source(content.get("pdf"), "pdf")
            jpg = next((url for item in content.get("imgs") or [] if isinstance(item, dict)
                        if (url := approved_source(item.get("src"), "jpg"))), None)
            if pdf or jpg:
                result[vin] = {"pdfUrl": pdf, "jpgUrl": jpg, "capturedAtUtc": record.get("startedAt")}
    return result


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "InventoryFlow/1.0"})
    with urllib.request.urlopen(request, timeout=35) as response:
        if response.status != 200:
            raise ValueError(f"Source returned HTTP {response.status}")
        content_type = response.headers.get_content_type()
        expected = "application/pdf" if url.lower().endswith(".pdf") else "image/jpeg"
        if content_type not in {expected, "application/octet-stream"}:
            raise ValueError("Unexpected source content type")
        payload = response.read(MAX_SOURCE_BYTES + 1)
    if not payload or len(payload) > MAX_SOURCE_BYTES:
        raise ValueError("Source exceeds size limit")
    return payload


def printable_pdf(payload: bytes, vin: str, source_type: str) -> tuple[bytes, str]:
    if source_type == "pdf":
        if not payload.startswith(b"%PDF-") or b"%%EOF" not in payload[-2048:]:
            raise ValueError("Invalid source PDF")
        reader = PdfReader(io.BytesIO(payload), strict=True)
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 3:
            raise ValueError("Source PDF is encrypted or has an unexpected page count")
        text = " ".join(page.extract_text() or "" for page in reader.pages).upper()
        compact = re.sub(r"\s+", "", text)
        if vin in compact:
            return payload, "printed_vin"
        if re.search(r"[A-HJ-NPR-Z0-9]{17}", compact):
            raise ValueError("Source PDF prints a different VIN")
        return payload, "vauto_exact_vin_image_only"
    if not payload.startswith(b"\xff\xd8\xff"):
        raise ValueError("Invalid source JPEG")
    with Image.open(io.BytesIO(payload)) as image:
        image.verify()
    with Image.open(io.BytesIO(payload)) as image:
        width, height = image.size
    if not 200 <= width <= 12000 or not 200 <= height <= 12000:
        raise ValueError("Source image dimensions are invalid")
    with Image.open(io.BytesIO(payload)) as image:
        artwork = ImageOps.exif_transpose(image).convert("RGB")
        landscape = artwork.width > artwork.height * 1.2
        page_width, page_height = (1650, 1275) if landscape else (1275, 1650)
        artwork.thumbnail((page_width - 100, page_height - 165), Image.Resampling.LANCZOS)
    page = Image.new("RGB", (page_width, page_height), "white")
    page.paste(artwork, ((page_width - artwork.width) // 2, 35))
    ImageDraw.Draw(page).text(
        (50, page_height - 75), f"vAuto equipment reference  |  VIN {vin}  |  Not an original window sticker",
        fill="black", font=ImageFont.load_default(size=22),
    )
    output = io.BytesIO()
    page.save(output, format="PDF", resolution=150.0)
    pdf = output.getvalue()
    return pdf, "vauto_exact_vin_image_only"


def cache_documents(root: Path, report_date: str, budget_seconds: int = 600, limit: int = 500) -> dict:
    vins = current_vins(root, report_date)
    sources = captured_sources(root, vins)
    folder = root / "work" / "vauto-documents"
    objects = folder / "objects"
    objects.mkdir(parents=True, exist_ok=True)
    index_path = folder / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"schema": "vauto-equipment-pdf-cache-v1", "byVin": {}, "failures": {}}
    if index.get("schema") != "vauto-equipment-pdf-cache-v1" or not isinstance(index.get("byVin"), dict):
        raise ValueError("Invalid vAuto PDF cache index")
    by_vin = index["byVin"]
    failures = index.setdefault("failures", {})
    if not isinstance(failures, dict):
        raise ValueError("Invalid vAuto PDF cache failures")

    def persist_index() -> None:
        temporary = folder / f"index.{os.getpid()}.tmp"
        temporary.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
        temporary.replace(index_path)

    saved = skipped = failed = skipped_failed = 0
    started = time.monotonic()
    ordered = sorted(sources.items(), key=lambda pair: (pair[0] in failures, pair[0]))
    for vin, source in ordered:
        previous = by_vin.get(vin) or {}
        sha = previous.get("sha256")
        file = objects / f"{sha}.pdf" if isinstance(sha, str) and re.fullmatch(r"[a-f0-9]{64}", sha) else None
        choices = [(url, kind) for kind, url in (("pdf", source["pdfUrl"]), ("jpg", source["jpgUrl"])) if url]
        if (previous.get("sourceUrl") in {url for url, _ in choices}
                and previous.get("vinVerification") in {"printed_vin", "vauto_exact_vin_image_only"}
                and (previous.get("sourceType") != "jpg" or previous.get("renderVersion") == 2)
                and file and file.exists()
                and hashlib.sha256(file.read_bytes()).hexdigest() == sha):
            skipped += 1
            continue
        if (failures.get(vin, {}).get("attemptedReportDate") == report_date
                and failures[vin].get("sourceUnavailable") is True):
            skipped_failed += 1
            continue
        if saved + failed >= limit or time.monotonic() - started >= budget_seconds:
            break
        try:
            errors = []
            for source_url, source_type in choices:
                try:
                    pdf, verification = printable_pdf(download(source_url), vin, source_type)
                    break
                except Exception as exc:
                    errors.append(f"{source_type}: {exc}")
            else:
                raise ValueError("; ".join(errors))
            sha = hashlib.sha256(pdf).hexdigest()
            destination = objects / f"{sha}.pdf"
            if not destination.exists():
                temporary = objects / f".{sha}.{os.getpid()}.tmp"
                temporary.write_bytes(pdf)
                temporary.replace(destination)
            by_vin[vin] = {"sourceUrl": source_url, "sourceType": source_type,
                           "capturedAtUtc": source["capturedAtUtc"], "sha256": sha, "bytes": len(pdf),
                           "vinVerification": verification, "savedReportDate": report_date,
                           **({"renderVersion": 2} if source_type == "jpg" else {})}
            failures.pop(vin, None)
            persist_index()
            saved += 1
        except Exception as exc:
            failed += 1
            failures[vin] = {"attemptedReportDate": report_date, "reason": str(exc)[:120],
                             "sourceUnavailable": bool(errors) and all("HTTP Error 404" in error for error in errors)}
            persist_index()
            print(json.dumps({"vin": vin, "status": "not_saved", "reason": str(exc)[:120]}), flush=True)
    persist_index()
    snapshots = folder / "snapshots"
    snapshots.mkdir(exist_ok=True)
    snapshot = snapshots / f"{report_date}-index.json"
    temporary = snapshots / f".{report_date}.{os.getpid()}.tmp"
    temporary.write_text(json.dumps({
        "schema": "vauto-equipment-pdf-snapshot-v1", "reportDate": report_date,
        "activeVins": len(vins), "sourceDocuments": len(sources),
        "byVin": {vin: by_vin[vin] for vin in sorted(vins) if vin in by_vin},
        "failures": {vin: failures[vin] for vin in sorted(vins) if vin in failures},
    }, indent=2) + "\n", encoding="utf-8")
    temporary.replace(snapshot)
    return {"reportDate": report_date, "active": len(vins), "sourceDocuments": len(sources),
            "saved": saved, "reused": skipped, "failed": failed,
            "unavailableToday": skipped_failed + failed,
            "remaining": len(sources) - saved - skipped - failed - skipped_failed, "folder": str(folder)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--report-date", required=True)
    parser.add_argument("--budget-seconds", type=int, default=600)
    parser.add_argument("--max", type=int, default=500)
    args = parser.parse_args()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.report_date) or args.budget_seconds < 1 or args.max < 0:
        parser.error("Invalid date or limit")
    print(json.dumps(cache_documents(args.workspace_root.resolve(), args.report_date, args.budget_seconds, args.max)))


if __name__ == "__main__":
    main()
