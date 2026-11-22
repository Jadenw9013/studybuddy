"""Verify revision-2 original bytes; added implementation files stay outside the manifest."""
import hashlib,json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
rows=[]
for name,earlier,current in re.findall(r'\| `([^`]+)` \| ([a-f0-9]{64}|-) \| ([a-f0-9]{64}) \|',(root/'HANDOFF-MANIFEST.md').read_text(encoding='utf-8')):
 p=root/name
 digest=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
 rows.append({'path':name,'expected':current,'actual':digest,'matches':digest==current})
print(json.dumps({'revision':2,'archive_sha256':'3079fa9efdc074aef62673a5d8bf8a5a56ab7abb3c1957328d8bc6877746b646','files':rows},indent=2))
sys.exit(0 if all(x['matches'] for x in rows) else 1)
