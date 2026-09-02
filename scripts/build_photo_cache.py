from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(DEFAULT_WORKSPACE_ROOT / "work"))
import inventory_report as photo_extractor  # noqa: E402


SCHEMA_VERSION = "inventory-ops-vehicle-resource-cache-v2"
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def manifest_public_validation_passed(manifest: dict[str, Any]) -> bool:
    validation = manifest.get("validation_results")
    if not isinstance(validation, dict):
        return False
    if validation.get("passed") is True:
        return True
    desktop_opened_without_repair = (
        validation.get("desktop_excel_opened_without_repair") is True
        or validation.get("desktop_excel_opened_without_repair_prompt") is True
    )
    read_only_hash_unchanged = (
        validation.get("read_only_validation_hash_unchanged") is True
        or validation.get("published_hash_unchanged_after_read_only_tests") is True
    )
    return (
        validation.get("public_sources_complete") is True
        and validation.get("workbook_validated") is True
        and desktop_opened_without_repair
        and validation.get("formula_errors") == 0
        and read_only_hash_unchanged
        and validation.get("macro_free") is True
    )


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def resolve_inside(workspace_root: Path, value: str, label: str) -> Path:
    candidate = Path(value)
    resolved = (candidate if candidate.is_absolute() else workspace_root / candidate).resolve()
    try:
        resolved.relative_to(workspace_root.resolve())
    except ValueError as exc:
        raise RuntimeError(f"{label} must stay inside the reporting workspace") from exc
    return resolved


def latest_completed_manifest(workspace_root: Path, report_date: str | None = None) -> Path:
    status_dir = workspace_root / "work" / "run-status"
    if report_date:
        if not DATE_PATTERN.fullmatch(report_date):
            raise RuntimeError("report date must use YYYY-MM-DD")
        candidates = [status_dir / f"{report_date}.json"]
    else:
        candidates = sorted(status_dir.glob("????-??-??.json"), reverse=True)
    for candidate in candidates:
        if not candidate.is_file():
            continue
        payload = json.loads(candidate.read_text(encoding="utf-8"))
        if payload.get("complete") is True:
            return candidate
    raise RuntimeError("No completed dated run manifest was found")


def validate_source(
    workspace_root: Path,
    manifest_path: Path,
) -> tuple[dict[str, Any], Path, dict[str, Any], str, str]:
    manifest_bytes = manifest_path.read_bytes()
    manifest_hash = hashlib.sha256(manifest_bytes).hexdigest().upper()
    manifest = json.loads(manifest_bytes.decode("utf-8"))
    report_date = str(manifest.get("report_date") or "")
    if (
        not DATE_PATTERN.fullmatch(report_date)
        or manifest_path.name != f"{report_date}.json"
        or manifest.get("complete") is not True
        or manifest.get("public_inventory_status") != "complete"
        or not manifest_public_validation_passed(manifest)
    ):
        raise RuntimeError("Run manifest is not a completed validated public release")

    snapshot_path = resolve_inside(
        workspace_root,
        str(manifest.get("public_snapshot_path") or ""),
        "Public snapshot",
    )
    if not snapshot_path.is_file() or not snapshot_path.name.startswith(report_date):
        raise RuntimeError("Public snapshot path does not match the report date")
    snapshot_bytes = snapshot_path.read_bytes()
    snapshot_hash = hashlib.sha256(snapshot_bytes).hexdigest().upper()
    snapshot = json.loads(snapshot_bytes.decode("utf-8"))
    vehicles = snapshot.get("vehicles")
    expected = manifest.get("source_counts", {}).get("public_unique_vins")
    if (
        snapshot.get("completed") is not True
        or snapshot.get("report_date") != report_date
        or not isinstance(vehicles, dict)
        or len(vehicles) != expected
    ):
        raise RuntimeError("Public snapshot does not reconcile to the run manifest")
    return manifest, snapshot_path, snapshot, snapshot_hash, manifest_hash


def cache_filename(report_date: str, snapshot_sha256: str) -> str:
    return f"{report_date}-{snapshot_sha256}.json"


def build_photo_cache(
    workspace_root: Path = DEFAULT_WORKSPACE_ROOT,
    report_date: str | None = None,
    cache_dir: Path | None = None,
    generated_at: str | None = None,
) -> tuple[Path, dict[str, Any]]:
    workspace_root = workspace_root.resolve()
    manifest_path = latest_completed_manifest(workspace_root, report_date)
    manifest, snapshot_path, snapshot, snapshot_hash, manifest_hash = validate_source(
        workspace_root,
        manifest_path,
    )
    report_date = manifest["report_date"]
    source_records = snapshot["vehicles"]
    records = [dict(record) for record in source_records.values()]

    resource_stats = photo_extractor.enrich_vehicle_resources_from_vdps(records)
    cached_vehicles: dict[str, dict[str, Any]] = {}
    for record in records:
        vin = str(record.get("vin") or "").strip().upper()
        urls = list(record.get("photo_urls") or [])
        preview = str(record.get("photo_preview_url") or "").strip()
        auto_check_report = record.get("autoCheckReport")
        window_sticker = record.get("windowSticker")
        if not vin or (not urls and not preview and not auto_check_report and not window_sticker):
            continue
        cached: dict[str, Any] = {
            "vin": vin,
            "listing_url": str(record.get("listing_url") or "").strip(),
            "photo_preview_url": preview or None,
            "photo_urls": urls,
            "photo_url_source": str(record.get("photo_url_source") or "Official VDP").strip(),
        }
        if isinstance(auto_check_report, dict):
            cached["autoCheckReport"] = dict(auto_check_report)
        if isinstance(window_sticker, dict):
            cached["windowSticker"] = dict(window_sticker)
        cached_vehicles[vin] = cached

    if file_sha256(snapshot_path) != snapshot_hash or file_sha256(manifest_path) != manifest_hash:
        raise RuntimeError("Audited source changed while the photo cache was being built; cache was not published")

    output_dir = (cache_dir or workspace_root / "apps" / "inventory-ops" / "data" / "photo-cache").resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / cache_filename(report_date, snapshot_hash)
    total_urls = sum(len(row["photo_urls"]) for row in cached_vehicles.values())
    vehicles_with_photos = sum(
        1 for row in cached_vehicles.values() if row["photo_urls"] or row["photo_preview_url"]
    )
    vehicles_with_autocheck = sum(
        1 for row in cached_vehicles.values() if isinstance(row.get("autoCheckReport"), dict)
    )
    vehicles_with_window_sticker = sum(
        1 for row in cached_vehicles.values() if isinstance(row.get("windowSticker"), dict)
    )
    autocheck_reports_parsed = sum(
        1
        for row in cached_vehicles.values()
        if row.get("autoCheckReport", {}).get("dataState") == "current"
    )
    window_stickers_parsed = sum(
        1
        for row in cached_vehicles.values()
        if row.get("windowSticker", {}).get("dataState") == "current"
    )
    payload = {
        "schema_version": SCHEMA_VERSION,
        "report_date": report_date,
        "public_snapshot_sha256": snapshot_hash,
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        "source": (
            "Official Bob Maxey vehicle-detail pages, VIN-validated AutoCheck reports, "
            "and VIN-validated factory window-sticker PDFs; allowlisted URLs only"
        ),
        "summary": {
            "public_vehicles": len(source_records),
            "vehicles_with_resources": len(cached_vehicles),
            "vehicles_with_photos": vehicles_with_photos,
            "vehicles_without_photos": len(source_records) - vehicles_with_photos,
            "vehicles_with_autocheck": vehicles_with_autocheck,
            "vehicles_with_window_sticker": vehicles_with_window_sticker,
            "autocheck_reports_parsed": autocheck_reports_parsed,
            "window_stickers_parsed": window_stickers_parsed,
            "photo_urls": total_urls,
            "per_store": resource_stats,
        },
        "vehicles": cached_vehicles,
    }

    serialized = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            dir=output_dir,
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, output_path)
        temp_path = None
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()
    return output_path, payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a verified app-only vehicle resource cache (photos, AutoCheck, and window sticker) "
            "without changing audited report artifacts."
        )
    )
    parser.add_argument("--workspace-root", type=Path, default=DEFAULT_WORKSPACE_ROOT)
    parser.add_argument("--report-date", help="Completed release date in YYYY-MM-DD format")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path, payload = build_photo_cache(args.workspace_root, args.report_date)
    print(
        "PHOTO_CACHE_SUMMARY="
        + json.dumps(
            {
                "path": str(output_path),
                "report_date": payload["report_date"],
                "public_snapshot_sha256": payload["public_snapshot_sha256"],
                **payload["summary"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
