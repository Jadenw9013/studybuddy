import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

spec = importlib.util.spec_from_file_location("ingest", Path(__file__).with_name("parser.py"))
ingest = importlib.util.module_from_spec(spec); spec.loader.exec_module(ingest)
ROOT = Path(__file__).resolve().parents[2]


class ParserTests(unittest.TestCase):
    def test_pdf_page_locator(self):
        data = ingest.parse(ROOT/"fixtures/lecture.pdf")
        page = next(p for p in data["passages"] if p["locator"]["physicalPage"] == 2)
        self.assertIn("Density equals bin count", page["text"])
        self.assertEqual(page["locator"]["pageIndex"], 1)

    def test_exact_csv(self):
        data = ingest.parse(ROOT/"fixtures/scores.csv")["dataset"]
        self.assertEqual([int(row["score"]) for row in data["rows"]], [0,5,10,10,15,20,25,30,35,40])
        self.assertEqual(data["numericColumns"], ["score"])

    def test_multiline_quoted_csv_and_formula(self):
        data = ingest.parse(ROOT/"fixtures/decoys/quoted.csv")["dataset"]
        self.assertEqual(data["rows"][0]["label"], "two, words")
        self.assertEqual(data["rows"][1]["label"], "line\nbreak")
        self.assertEqual(data["rows"][2]["score"], "=1+1")
        self.assertEqual(data["invalid"]["score"], 1)

    def test_notebook_never_outputs(self):
        sample={"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[{"id":"stable","cell_type":"code","metadata":{},"execution_count":None,"source":"print('safe')","outputs":[{"output_type":"display_data","metadata":{},"data":{"text/html":"<script>bad()</script>"}}]}]}
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"test.ipynb";path.write_text(json.dumps(sample))
            data=ingest.parse(path)
        self.assertEqual(data["notebook"]["cells"][0]["id"], "stable")
        self.assertNotIn("<script>", json.dumps(data))

    def test_scan_visible_gap(self):
        data=ingest.parse(ROOT/"fixtures/decoys/no-text.pdf")
        self.assertEqual(data["status"], "needs_attention")
        self.assertEqual(data["skippedPages"], [1])

    def test_older_notebook_fallback_identity_stable(self):
        sample={"nbformat":4,"nbformat_minor":4,"metadata":{},"cells":[{"cell_type":"markdown","metadata":{},"source":"An older notebook cell"}]}
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"old.ipynb";path.write_text(json.dumps(sample))
            first=ingest.parse(path)["notebook"]["cells"][0]["id"]
            second=ingest.parse(path)["notebook"]["cells"][0]["id"]
        self.assertEqual(first,second)
        self.assertTrue(first.startswith("cell-1-"))

    def test_malformed_csv_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"bad.csv";path.write_text("a,b\n1,2,3\n")
            with self.assertRaises(ValueError): ingest.parse(path)

    def test_nonfinite_exclusions(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"numeric.csv";path.write_text("x\n1\nNaN\nInfinity\n\"\"\n")
            data=ingest.parse(path)["dataset"]
            self.assertEqual(data["invalid"]["x"], 2)
            self.assertEqual(data["missing"]["x"], 1)

    def test_disguised_pdf_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"bad.pdf";path.write_text("<html>not PDF</html>")
            with self.assertRaises(ValueError): ingest.parse(path)

    def test_dsa_mock_files_are_data_with_citable_nodes_and_edges(self):
        for path in (ROOT/"fixtures/dsa").glob("*.json"):
            data=ingest.parse(path)
            self.assertIn(data["dsa"]["kind"], ("graph", "binary_tree", "bst"))
            self.assertTrue(data["passages"])
            self.assertTrue(all(p["locator"]["dsa"] for p in data["passages"]))
            self.assertTrue(any(p["locator"].get("nodeId") for p in data["passages"]))

    def test_dsa_unknown_nodes_duplicate_ids_and_bad_bst_rejected(self):
        sample=json.loads((ROOT/"fixtures/dsa/04-binary-search-tree.json").read_text())
        for variant in ("edge", "duplicate", "order", "nan"):
            data=json.loads(json.dumps(sample))
            if variant=="edge": data["structure"]["edges"][0]["to"]="missing"
            if variant=="duplicate": data["structure"]["nodes"][1]["id"]="n8"
            if variant=="order": data["structure"]["nodes"][1]["value"]=20
            if variant=="nan": data["structure"]["nodes"][1]["value"]=float("nan")
            with self.assertRaises(ValueError): ingest.parse_dsa(data)

    def test_json_is_not_an_arbitrary_execution_or_render_format(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"unsafe.json"
            path.write_text(json.dumps({"code":"run something", "url":"https://example.invalid"}))
            with self.assertRaises(ValueError): ingest.parse(path)

    def test_cli_emits_utf8_even_under_a_windows_style_stdout_locale(self):
        import os
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"unicode.txt";path.write_text("Trees — graphs → queues and stacks. α β", encoding="utf-8")
            process=subprocess.run([sys.executable,str(Path(__file__).with_name("parser.py")),str(path)],capture_output=True,env={**os.environ,"PYTHONIOENCODING":"cp1252"})
            self.assertEqual(process.returncode,0)
            data=json.loads(process.stdout.decode("utf-8"))
            self.assertIn("α β",data["passages"][0]["text"])


if __name__ == "__main__": unittest.main()
