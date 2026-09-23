import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from pypdf import PdfReader

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "cache-vauto-equipment-pdfs.py"
spec = importlib.util.spec_from_file_location("vauto_pdf_cache", SCRIPT)
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)

VIN = "1FTFW1E84RKF12345"
PDF_URL = "https://assets.cai-media-management.com/window-stickers/15fe2ec7-42e9-4d24-a549-5e749b01102e.pdf"
JPG_URL = "https://assets.cai-media-management.com/window-stickers/123e4567-e89b-42d3-a456-426614174000.jpg"


class VautoPdfCacheTests(unittest.TestCase):
    def test_only_allowlisted_source_urls(self):
        self.assertEqual(cache.approved_source(PDF_URL, "pdf"), PDF_URL)
        for url in [PDF_URL.replace("assets.cai-media-management.com", "evil.example"),
                    PDF_URL + "?redirect=evil", PDF_URL.replace(".pdf", ".png")]:
            self.assertIsNone(cache.approved_source(url, "pdf"))

    def test_jpeg_becomes_one_page_printable_pdf(self):
        image = Image.new("RGB", (800, 1200), "white")
        source = io.BytesIO()
        image.save(source, format="JPEG")
        pdf, verification = cache.printable_pdf(source.getvalue(), VIN, "jpg")
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertEqual(verification, "vauto_exact_vin_image_only")
        self.assertEqual(len(PdfReader(io.BytesIO(pdf)).pages), 1)

        wide = Image.new("RGB", (1200, 700), "white")
        source = io.BytesIO()
        wide.save(source, format="JPEG")
        wide_pdf, _ = cache.printable_pdf(source.getvalue(), VIN, "jpg")
        page = PdfReader(io.BytesIO(wide_pdf)).pages[0]
        self.assertGreater(float(page.mediabox.width), float(page.mediabox.height))

    def test_broken_source_falls_back_to_jpeg_then_reuses_saved_pdf(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "work" / "inventory-history" / "snapshots"
            snapshot.mkdir(parents=True)
            (snapshot / "2026-09-23-public.json").write_text(json.dumps({
                "report_date": "2026-09-23", "completed": True, "vehicles": {VIN: {"vin": VIN}}
            }))
            history = root / "work" / "vauto-history"
            history.mkdir()
            (history / "2026-09-22-factory-equipment.json").write_text(json.dumps({"records": [{
                "vin": VIN, "result": "OK", "startedAt": "2026-09-22T12:00:00Z",
                "content": {"pdf": PDF_URL, "imgs": [{"src": JPG_URL}]},
            }]}))
            image = Image.new("RGB", (800, 1200), "white")
            source = io.BytesIO()
            image.save(source, format="JPEG")

            def download(url):
                if url == PDF_URL:
                    raise ValueError("PDF unavailable")
                return source.getvalue()

            with patch.object(cache, "download", side_effect=download) as fetch:
                result = cache.cache_documents(root, "2026-09-23")
                self.assertEqual(result["saved"], 1)
                self.assertEqual(fetch.call_count, 2)
                result = cache.cache_documents(root, "2026-09-23")
                self.assertEqual(result["reused"], 1)
                self.assertEqual(fetch.call_count, 2)
            index = json.loads((root / "work" / "vauto-documents" / "index.json").read_text())
            self.assertEqual(index["byVin"][VIN]["sourceUrl"], JPG_URL)
            self.assertTrue((root / "work" / "vauto-documents" / "objects" /
                             f"{index['byVin'][VIN]['sha256']}.pdf").exists())
            snapshot = json.loads((root / "work" / "vauto-documents" / "snapshots" /
                                   "2026-09-23-index.json").read_text())
            self.assertEqual(snapshot["byVin"][VIN]["sha256"], index["byVin"][VIN]["sha256"])

    def test_transient_failure_can_retry_on_the_same_day(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = root / "work" / "inventory-history" / "snapshots"
            snapshot.mkdir(parents=True)
            (snapshot / "2026-09-23-public.json").write_text(json.dumps({
                "report_date": "2026-09-23", "completed": True, "vehicles": {VIN: {"vin": VIN}}
            }))
            history = root / "work" / "vauto-history"
            history.mkdir()
            (history / "2026-09-23-factory-equipment.json").write_text(json.dumps({"records": [{
                "vin": VIN, "result": "OK", "startedAt": "2026-09-23T12:00:00Z",
                "content": {"imgs": [{"src": JPG_URL}]},
            }]}))
            source = io.BytesIO()
            Image.new("RGB", (800, 1200), "white").save(source, format="JPEG")
            with patch.object(cache, "download", side_effect=[TimeoutError("temporary"), source.getvalue()]) as fetch:
                self.assertEqual(cache.cache_documents(root, "2026-09-23")["failed"], 1)
                self.assertEqual(cache.cache_documents(root, "2026-09-23")["saved"], 1)
                self.assertEqual(fetch.call_count, 2)


if __name__ == "__main__":
    unittest.main()
