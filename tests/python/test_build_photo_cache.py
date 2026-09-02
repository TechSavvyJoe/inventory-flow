from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "build_photo_cache.py"
SPEC = importlib.util.spec_from_file_location("build_photo_cache", SCRIPT_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)


class PhotoCacheBuilderTests(unittest.TestCase):
    def test_accepts_current_granular_public_validation_evidence(self) -> None:
        self.assertTrue(
            builder.manifest_public_validation_passed(
                {
                    "validation_results": {
                        "public_sources_complete": True,
                        "workbook_validated": True,
                        "desktop_excel_opened_without_repair": True,
                        "formula_errors": 0,
                        "read_only_validation_hash_unchanged": True,
                        "macro_free": True,
                    }
                }
            )
        )
        self.assertFalse(
            builder.manifest_public_validation_passed(
                {
                    "validation_results": {
                        "public_sources_complete": True,
                        "workbook_validated": True,
                        "desktop_excel_opened_without_repair": True,
                        "formula_errors": 1,
                        "read_only_validation_hash_unchanged": True,
                        "macro_free": True,
                    }
                }
            )
        )
        self.assertTrue(
            builder.manifest_public_validation_passed(
                {
                    "validation_results": {
                        "public_sources_complete": True,
                        "workbook_validated": True,
                        "desktop_excel_opened_without_repair_prompt": True,
                        "formula_errors": 0,
                        "published_hash_unchanged_after_read_only_tests": True,
                        "macro_free": True,
                    }
                }
            )
        )

    def test_builds_separate_hash_bound_cache_without_changing_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report_date = "2026-08-29"
            snapshot_dir = root / "work" / "inventory-history" / "snapshots"
            status_dir = root / "work" / "run-status"
            snapshot_dir.mkdir(parents=True)
            status_dir.mkdir(parents=True)
            vin = "1FMCU0GD6JUC18203"
            listing_url = f"https://www.bobmaxeyfordhowell.com/used-Howell-test-{vin}"
            snapshot_path = snapshot_dir / f"{report_date}.json"
            snapshot_path.write_text(
                json.dumps(
                    {
                        "completed": True,
                        "report_date": report_date,
                        "vehicles": {
                            vin: {
                                "vin": vin,
                                "store": "Howell",
                                "listing_url": listing_url,
                                "photo_count": 2,
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            manifest_path = status_dir / f"{report_date}.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "report_date": report_date,
                        "complete": True,
                        "public_inventory_status": "complete",
                        "public_snapshot_path": str(snapshot_path),
                        "source_counts": {"public_unique_vins": 1},
                        "validation_results": {"passed": True},
                    }
                ),
                encoding="utf-8",
            )
            snapshot_before = snapshot_path.read_bytes()
            manifest_before = manifest_path.read_bytes()

            def fake_enrichment(records: list[dict[str, object]]) -> dict[str, dict[str, int]]:
                records[0]["photo_urls"] = [
                    "https://www.bobmaxeyfordhowell.com/"
                    "inventoryphotos/11801/1fmcu0gd6juc18203/ip/1.jpg"
                ]
                records[0]["photo_url_source"] = "Official VDP"
                records[0]["autoCheckReport"] = {
                    "url": listing_url.replace(f"/used-Howell-test-{vin}", "/autocheck.aspx?sv=token&ac=report"),
                    "dataState": "current",
                    "validated_vin": vin,
                    "score": 91,
                    "checks": [{"label": "Accident / Damage", "status": "No Issue"}],
                }
                records[0]["windowSticker"] = {
                    "url": listing_url.replace(
                        f"/used-Howell-test-{vin}",
                        "/api/vhcliaa/inventory/21521/window-sticker?sv=token&make=Ford&vehicleType=U",
                    ),
                    "dataState": "current",
                    "validated_vin": vin,
                    "totalMsrp": 42000,
                }
                return {
                    store: {
                        "photo_vdps_requested": 1 if store == "Howell" else 0,
                        "photo_vdps_enriched": 1 if store == "Howell" else 0,
                        "photo_vdps_failed": 0,
                        "photo_urls_observed": 1 if store == "Howell" else 0,
                        "resource_vdps_requested": 1 if store == "Howell" else 0,
                        "resource_vdps_failed": 0,
                        "autocheck_links_observed": 1 if store == "Howell" else 0,
                        "autocheck_reports_parsed": 1 if store == "Howell" else 0,
                        "autocheck_reports_failed": 0,
                        "window_sticker_links_observed": 1 if store == "Howell" else 0,
                        "window_stickers_parsed": 1 if store == "Howell" else 0,
                        "window_stickers_failed": 0,
                    }
                    for store in ("Howell", "Fowlerville", "Ford Detroit", "Lincoln")
                }

            with patch.object(
                builder.photo_extractor,
                "enrich_vehicle_resources_from_vdps",
                side_effect=fake_enrichment,
            ):
                output_path, payload = builder.build_photo_cache(
                    workspace_root=root,
                    report_date=report_date,
                    generated_at="2026-08-30T00:00:00+00:00",
                )

            self.assertEqual(snapshot_path.read_bytes(), snapshot_before)
            self.assertEqual(manifest_path.read_bytes(), manifest_before)
            self.assertEqual(
                output_path.name,
                builder.cache_filename(report_date, builder.file_sha256(snapshot_path)),
            )
            self.assertEqual(payload["summary"]["public_vehicles"], 1)
            self.assertEqual(payload["summary"]["vehicles_with_photos"], 1)
            self.assertEqual(payload["summary"]["photo_urls"], 1)
            self.assertEqual(payload["summary"]["vehicles_with_autocheck"], 1)
            self.assertEqual(payload["summary"]["vehicles_with_window_sticker"], 1)
            self.assertEqual(payload["vehicles"][vin]["autoCheckReport"]["score"], 91)
            self.assertEqual(payload["vehicles"][vin]["windowSticker"]["totalMsrp"], 42000)
            self.assertTrue(output_path.is_file())


if __name__ == "__main__":
    unittest.main()
