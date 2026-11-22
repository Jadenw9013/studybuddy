"""Independent NumPy/SciPy oracle; reads app calculations, never learner code."""
from pathlib import Path
import json
import numpy as np
from scipy.stats import linregress
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'evals/results/numeric-probe.json').read_text())
for case in data['histograms']:
 values=np.array([float('nan') if x is None else x for x in case['input']['values']]);values=values[np.isfinite(values)]
 edges=case['input']['edges'];counts,_=np.histogram(values,bins=edges);density,_=np.histogram(values,bins=edges,density=True)
 assert counts.tolist()==case['result']['counts']
 np.testing.assert_allclose(density,[x['density'] for x in case['result']['bins']],rtol=1e-12)
 assert abs(case['result']['area']-1)<1e-12
r=data['regression'];oracle=linregress(r['x'],r['y']);assert oracle.slope==r['fit']['slope']==2
assert r['prediction']==10
assert data['constant']['defined'] is False
out={'kind':'independent-numeric-oracle','numpy':np.__version__,'scipy':__import__('scipy').__version__,'histogramCases':4,'regressionCases':2,'passed':6,'failed':0}
(root/'evals/results/numeric-oracle.json').write_text(json.dumps(out,indent=2))
print(json.dumps(out))
